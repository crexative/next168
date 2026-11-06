import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { ExternalOccurrence } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import { publishGoogleSnapshot, type DateWindow, type GoogleCoverage } from '../googleCalendar'
import { PERMISSIONS_URL, googleServerBuild, googleTokenSource, isInstalledContext, takeGoogleReturn, type TokenSource } from '../googleGate'
import { memoryOnlySavedEvents, savedCopyOf, savedGoogleEvents, type SavedBinding, type SavedGoogleEventsPort } from '../googleSavedEvents'
import { EVENTS_READONLY, type GisErrorResponse, type GisOAuth2, type GisTokenResponse } from './gis'
import { loadGis } from './gisLoader'
import { fetchPrimaryEvents, type GoogleFailure } from './googleApi'
import { normalizeGoogleEvents } from './googleNormalize'
import type { MintResult, ServerCode, ServerConnection } from './serverConnection'

// The Google Calendar connection of this tab. The token lives in memory only and is never written anywhere. It comes
// from one of two sources: Google Identity Services (a popup per hour) or the Weeklid server, which keeps Google's
// permission for this device so the tab stays connected (design S1b). In a build without VITE_GOOGLE_SERVER the last
// complete read is also kept on this device (googleSavedEvents.ts), bound to the planner and zone it was read for, so a
// reload shows it at once; Disconnect, Delete all data, an import or restore, a new workspace or zone, and Google
// withdrawing the permission delete it. In a server build no context saves anything. Nothing here reaches
// localStorage, Cache Storage or the console.

export const REVOKE_DEADLINE_MS = 10_000
// A token is treated as expired a minute early, so a request never starts with one about to lapse.
const EXPIRY_MARGIN_MS = 60_000
const PAST_DAYS = 7
const FUTURE_DAYS = 42
const DAY_MS = 86_400_000
export const FORGET_CHANNEL = 'next168-google'
export { PERMISSIONS_URL }
// A saved copy older than this says its events may be out of date.
export const SAVED_STALE_AFTER_MS = 86_400_000

export function savedCopyIsStale(fetchedAt: string, now: Date): boolean {
  return now.getTime() - Date.parse(fetchedAt) > SAVED_STALE_AFTER_MS
}
const ERROR_CODE = /^[A-Za-z_]{1,40}$/

export interface GoogleServices {
  clientId: string
  loadGis(): Promise<GisOAuth2>
  fetch: typeof fetch
  now(): Date
  channel(): Pick<BroadcastChannel, 'postMessage' | 'addEventListener'> | undefined
  saved(): SavedGoogleEventsPort
  source: TokenSource
  // An installed app that stays on Google Identity Services in a server build (gate G-1): it says why.
  installedNote: boolean
  // Undefined in a build without the server flag, so none of the server client ships there.
  server: (() => Promise<ServerConnection>) | undefined
  online(): boolean
  navigate(url: string): void
}

function defaultServices(): GoogleServices {
  return {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
    loadGis: () => loadGis(),
    fetch: (...args) => globalThis.fetch(...args),
    now: () => new Date(),
    channel: () => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(FORGET_CHANNEL) : undefined),
    saved: googleServerBuild() ? () => memoryOnlySavedEvents : savedGoogleEvents,
    source: googleTokenSource(),
    installedNote: googleServerBuild() && googleTokenSource() === 'gis' && isInstalledContext(),
    server: import.meta.env.VITE_GOOGLE_SERVER === '1' ? () => import('./serverConnection').then((module) => module.browserServerConnection()) : undefined,
    online: () => typeof navigator === 'undefined' || navigator.onLine !== false,
    navigate: (url) => { globalThis.location.assign(url) },
  }
}

let services: GoogleServices = defaultServices()

// Tests replace Google, the network and the clock here, before the store is first used.
export function configureGoogleServices(next: Partial<GoogleServices>): void {
  services = { ...defaultServices(), ...next }
}

export interface GoogleMessage {
  key: string
  tone: 'error' | 'ok' | 'info'
  params?: Record<string, string | number>
  // Offers the Google Account permissions page.
  permissionsLink?: boolean
  // The text sits beside the connection messages instead of inside them.
  topLevel?: boolean
}

type DiagnosticKind = 'token' | 'events' | 'revoke'
export interface DiagnosticEntry { result: string; at: string }

// Everything a request started with: the connection generation and the planner it belongs to. A result is used only
// while all three still match, so Disconnect, Delete all data and an import or restore win over late answers.
interface Ticket { generation: number; workspaceId: string | undefined; plannerGeneration: number | undefined }

export function fetchWindow(now: Date, timeZone: string): DateWindow & { timeMin: string; timeMax: string } {
  const today = localDateOf(now, timeZone)
  const start = addLocalDays(today, -PAST_DAYS), end = addLocalDays(today, FUTURE_DAYS)
  return {
    start,
    end,
    timeMin: new Date(zonedInstant(start, 0, timeZone).getTime() - DAY_MS).toISOString(),
    timeMax: new Date(zonedInstant(end, 0, timeZone).getTime() + DAY_MS).toISOString(),
  }
}

function safeCode(value: unknown): string {
  return typeof value === 'string' && ERROR_CODE.test(value) ? value : 'unknown'
}

function failureMessage(failure: GoogleFailure): GoogleMessage | null {
  switch (failure.code) {
    case 'aborted': return null
    case 'denied': return { key: 'denied', tone: 'error', params: { reason: failure.reason } }
    case 'server': return { key: 'server', tone: 'error', params: { status: failure.status } }
    case 'malformed': return { key: 'format', tone: 'error' }
    default: return { key: failure.code, tone: 'error' }
  }
}

export const useGoogleConnection = defineStore('googleConnection', () => {
  const planner = usePlannerStore()

  const gis = ref<'idle' | 'loading' | 'ready' | 'failed'>('idle')
  const phase = ref<'idle' | 'authorizing' | 'fetching' | 'revoking'>('idle')
  // 'new' until a connection succeeds in this tab; 'disconnected' after Disconnect here or in another tab; 'unavailable'
  // when the server source could not be asked (offline, server down or paused) and nothing is known yet.
  const session = ref<'new' | 'connected' | 'disconnected' | 'unavailable'>('new')
  // A 401 dropped the token while events are still shown: the next tap asks Google again.
  const expired = ref(false)
  // The events shown are the copy saved on this device, not yet read again in this tab.
  const fromDevice = ref(false)
  const generation = ref(0)
  const occurrences = shallowRef<ExternalOccurrence[]>([])
  const coverage = ref<GoogleCoverage | undefined>()
  const message = ref<GoogleMessage | null>(null)
  const tokenExpiresAt = ref<number | undefined>()
  const diagnostics = reactive<{ scopeGranted?: boolean; last: Partial<Record<DiagnosticKind, DiagnosticEntry>> }>({ last: {} })
  const source = services.source
  const serverMode = source === 'server'
  const serverBuild = googleServerBuild()
  const installedNote = services.installedNote
  // The last answer of the Weeklid server, as its closed code: shown in Details, never a token or a reply body.
  const lastServerCode = ref<ServerCode | undefined>()

  const saved = services.saved()
  const channel = services.channel()
  // Never reactive, never exposed: the access token.
  let token: { value: string; expiresAt: number } | undefined
  let oauth2: GisOAuth2 | undefined
  const inflight = new Set<AbortController>()

  const hasLiveToken = () => token !== undefined && token.expiresAt > services.now().getTime()
  const busy = computed(() => phase.value !== 'idle')

  function bindingOf(document = planner.document): SavedBinding | undefined {
    return document ? { workspaceId: document.workspaceId, plannerGeneration: document.generation, timeZone: document.settings.timeZone } : undefined
  }

  function capture(): Ticket {
    return { generation: generation.value, workspaceId: planner.document?.workspaceId, plannerGeneration: planner.document?.generation }
  }

  function isCurrent(ticket: Ticket | undefined): ticket is Ticket {
    return ticket !== undefined
      && ticket.generation === generation.value
      && ticket.workspaceId === planner.document?.workspaceId
      && ticket.plannerGeneration === planner.document?.generation
  }

  function record(kind: DiagnosticKind, result: string | number): void {
    diagnostics.last[kind] = { result: String(result), at: services.now().toISOString() }
  }

  function publish(): void {
    publishGoogleSnapshot({ occurrences: occurrences.value, ...(coverage.value ? { coverage: coverage.value } : {}) })
  }

  function revokeQuietly(value: string | undefined): void {
    if (value) oauth2?.revoke(value, () => undefined)
  }

  // Drops everything this tab holds and makes every request in flight, and every answer still to come, obsolete.
  function forget(): void {
    generation.value += 1
    for (const controller of inflight) controller.abort()
    inflight.clear()
    token = undefined
    tokenExpiresAt.value = undefined
    expired.value = false
    occurrences.value = []
    coverage.value = undefined
    fromDevice.value = false
    phase.value = 'idle'
    publish()
  }

  // Shows the copy saved on this device when it belongs to this planner and zone and nothing newer is shown; a copy
  // for anything else is deleted. Runs when the planner first loads and whenever it or its zone changes.
  async function keepMatchingCopy(): Promise<void> {
    const binding = bindingOf()
    if (!binding) return
    const ticket = capture()
    const copy = await saved.loadMatching(binding).catch(() => undefined)
    if (!copy || !isCurrent(ticket) || coverage.value || planner.document?.settings.timeZone !== binding.timeZone) return
    occurrences.value = copy.occurrences
    coverage.value = copy.coverage
    fromDevice.value = true
    session.value = 'connected'
    publish()
  }

  // The copy on this device goes too, here and in every other tab.
  function forgetEverywhere(): void {
    forget()
    const epoch = saved.discard()
    channel?.postMessage({ type: 'forget', epoch })
  }

  // A replaced planner (Delete all data, an import or a restore, here or in another tab) is a new owner: what was
  // read for the old one goes, from memory and from the device. The planner's first load shows the saved copy.
  watch(() => (planner.document ? `${planner.document.workspaceId}\u0000${planner.document.generation}` : undefined), (next, previous) => {
    if (next === previous) return
    if (previous !== undefined) forget()
    if (next !== undefined) void keepMatchingCopy()
    if (serverMode && previous === undefined && next !== undefined) void openServerSession()
  }, { flush: 'sync', immediate: true })

  // Civil dates mean something only in the zone they were read in: a new planner zone drops the events and their
  // coverage (and any read still on its way, and the saved copy), keeps the token, and Week and Today offer Update.
  watch(() => planner.document?.settings.timeZone, (next, previous) => {
    if (previous === undefined || next === previous) return
    for (const controller of inflight) controller.abort()
    occurrences.value = []
    coverage.value = undefined
    fromDevice.value = false
    publish()
    void keepMatchingCopy()
  }, { flush: 'sync' })

  channel?.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as { type?: unknown; epoch?: unknown } | null
    if (data?.type !== 'forget') return
    forget()
    saved.adopt(data.epoch)
    session.value = 'disconnected'
    message.value = null
  })

  // Google says this connection may no longer read the calendar: what was read under it goes everywhere.
  function grantGone(): void {
    forgetEverywhere()
    session.value = 'new'
  }

  // Each request has its own callback bound to the ticket of its own tap: a late answer to an older request can never
  // take the place of a newer one.
  function onToken(response: GisTokenResponse, ticket: Ticket): void {
    if (response.error) {
      record('token', safeCode(response.error))
      if (isCurrent(ticket)) {
        phase.value = 'idle'
        if (response.error === 'access_denied') grantGone()
        message.value = response.error === 'access_denied' ? { key: 'accessDenied', tone: 'info' } : { key: 'authFailed', tone: 'error', params: { code: safeCode(response.error) } }
      }
      return
    }
    if (!isCurrent(ticket)) {
      // Asked for before a Disconnect or a planner replacement: given back to Google unused.
      record('token', 'stale')
      revokeQuietly(response.access_token)
      return
    }
    phase.value = 'idle'
    if (!response.access_token || !oauth2?.hasGrantedAllScopes(response, EVENTS_READONLY)) {
      diagnostics.scopeGranted = false
      record('token', 'missingScope')
      revokeQuietly(response.access_token)
      grantGone()
      message.value = { key: 'missingScope', tone: 'error' }
      return
    }
    const lifetime = Number(response.expires_in)
    token = { value: response.access_token, expiresAt: services.now().getTime() + (Number.isFinite(lifetime) ? lifetime : 0) * 1000 - EXPIRY_MARGIN_MS }
    tokenExpiresAt.value = token.expiresAt
    diagnostics.scopeGranted = true
    record('token', 'granted')
    session.value = 'connected'
    expired.value = false
    void refresh(ticket, true)
  }

  function onTokenError(error: GisErrorResponse, ticket: Ticket): void {
    record('token', safeCode(error?.type))
    if (!isCurrent(ticket)) return
    phase.value = 'idle'
    if (error?.type === 'popup_failed_to_open') message.value = { key: 'popupBlocked', tone: 'error', params: { host: globalThis.location?.host ?? '' } }
  }

  // --- The Weeklid server source ---------------------------------------------------------------------------------------

  let serverClient: Promise<ServerConnection> | undefined
  const serverConnection = (): Promise<ServerConnection> => (serverClient ??= services.server!())

  function noteServerFailure(code: ServerCode): GoogleMessage {
    lastServerCode.value = code
    if (code === 'lockUnavailable') return { key: 'lockUnavailable', tone: 'error' }
    if (code === 'disabled' || code === 'notConfigured') return { key: 'serverPaused', tone: 'info' }
    return { key: 'serverUnavailable', tone: 'error' }
  }

  // Nothing could be asked: a connected tab keeps what it shows; a tab that knows nothing says so.
  function serverUnavailable(notice: GoogleMessage): void {
    phase.value = 'idle'
    if (session.value !== 'connected') session.value = 'unavailable'
    record('token', notice.key)
    message.value = notice
  }

  function applyMint(result: MintResult, ticket: Ticket): boolean {
    if (!isCurrent(ticket)) return false
    if (result.kind === 'token') {
      lastServerCode.value = 'ok'
      const expiresAt = services.now().getTime() + result.expiresIn * 1000 - EXPIRY_MARGIN_MS
      token = { value: result.accessToken, expiresAt }
      tokenExpiresAt.value = expiresAt
      record('token', 'granted')
      session.value = 'connected'
      expired.value = false
      return true
    }
    if (result.kind === 'signedOut') {
      lastServerCode.value = result.code
      record('token', result.code)
      const wasConnected = session.value === 'connected'
      forget()
      session.value = 'disconnected'
      // Neutral on every 401: whatever the server says, this tab holds nothing now.
      message.value = wasConnected ? { key: 'reconnectNeeded', tone: 'info' } : null
      return false
    }
    serverUnavailable(noteServerFailure(result.code))
    return false
  }

  // Opening the app, and Update without a live token: ask the server for a token and read the events. Offline sends
  // nothing; a person who is connected keeps what the tab already shows.
  async function mintAndRead(ticket: Ticket): Promise<void> {
    if (!services.online()) {
      serverUnavailable({ key: 'network', tone: 'info' })
      return
    }
    phase.value = 'fetching'
    message.value = null
    const result = await (await serverConnection()).mint()
    if (applyMint(result, ticket)) await refresh(ticket)
    else if (isCurrent(ticket) && phase.value === 'fetching') phase.value = 'idle'
  }

  async function openServerSession(): Promise<void> {
    const returned = takeGoogleReturn()
    const ticket = capture()
    await mintAndRead(ticket)
    if (returned && returned !== 'connected' && isCurrent(ticket)) message.value = returnMessage(returned)
  }

  function returnMessage(returned: string): GoogleMessage {
    if (returned === 'denied') return { key: 'accessDenied', tone: 'info' }
    if (returned === 'disabled' || returned === 'notConfigured' || returned === 'canary') return { key: 'serverPaused', tone: 'info' }
    return { key: 'connectFailed', tone: 'error', params: { code: safeCode(returned) } }
  }

  // The Connect sheet's Continue: the server starts the authorization, then the whole page goes to Google and comes back
  // to the address the server chose. The lock is released before the page leaves.
  async function connectServer(): Promise<void> {
    if (phase.value !== 'idle') return
    if (!services.online()) {
      serverUnavailable({ key: 'network', tone: 'info' })
      return
    }
    const ticket = capture()
    phase.value = 'authorizing'
    message.value = null
    const result = await (await serverConnection()).connect()
    if (!isCurrent(ticket)) return
    if (result.kind === 'url') {
      lastServerCode.value = 'ok'
      services.navigate(result.url)
      return
    }
    phase.value = 'idle'
    message.value = noteServerFailure(result.code)
    record('token', result.code)
  }

  // Disconnect for the server source: the tab forgets only after the server gave a terminal answer.
  async function disconnectServer(): Promise<void> {
    if (!services.online()) return
    const ticket = capture()
    phase.value = 'revoking'
    message.value = null
    const outcome = await (await serverConnection()).forgetThisDevice(true)
    record('revoke', outcome)
    if (!isCurrent(ticket)) return
    if (outcome === 'failed') {
      phase.value = 'idle'
      message.value = { key: 'disconnectFailed', tone: 'error' }
      return
    }
    forgetEverywhere()
    session.value = 'disconnected'
    message.value = outcome === 'confirmed'
      ? { key: 'revokeConfirmed', tone: 'ok' }
      : outcome === 'mayRemain'
        ? { key: 'googleAccessMayRemain', tone: 'info', permissionsLink: true, topLevel: true }
        : { key: 'revokeUnconfirmedServer', tone: 'info', permissionsLink: true }
  }

  // Loads Google's script when the Connect sheet opens; the button waits for it, so the tap itself never waits.
  function prepare(): void {
    if (serverMode || gis.value === 'loading' || gis.value === 'ready') return
    gis.value = 'loading'
    if (message.value?.key === 'gisLoad') message.value = null
    services.loadGis().then((api) => {
      oauth2 = api
      gis.value = 'ready'
    }, () => {
      gis.value = 'failed'
      record('token', 'gisLoad')
      message.value = { key: 'gisLoad', tone: 'error' }
    })
  }

  // Must run synchronously inside the click: Google opens its window only from a user gesture.
  function requestToken(): boolean {
    if (!oauth2 || phase.value !== 'idle') return false
    const ticket = capture()
    const client = oauth2.initTokenClient({
      client_id: services.clientId,
      scope: EVENTS_READONLY,
      include_granted_scopes: false,
      prompt: '',
      callback: (response) => onToken(response, ticket),
      error_callback: (error) => onTokenError(error, ticket),
    })
    phase.value = 'authorizing'
    message.value = null
    client.requestAccessToken()
    return true
  }

  // `fresh`: the token was granted in this same tap, so a 401 means Google withdrew the permission, not that it lapsed.
  async function refresh(ticket: Ticket, fresh = false): Promise<void> {
    const current = token
    const document = planner.document
    if (!current || !document || !isCurrent(ticket)) return
    const timeZone = document.settings.timeZone
    const window = fetchWindow(services.now(), timeZone)
    const sameZone = () => planner.document?.settings.timeZone === timeZone
    const controller = new AbortController()
    inflight.add(controller)
    phase.value = 'fetching'
    message.value = null
    try {
      const result = await fetchPrimaryEvents({ token: current.value, timeMin: window.timeMin, timeMax: window.timeMax, signal: controller.signal, request: services.fetch })
      if (!isCurrent(ticket) || !sameZone()) return
      if (!result.ok) {
        record('events', result.status ?? result.failure.code)
        if (result.failure.code === 'expired') {
          token = undefined
          tokenExpiresAt.value = undefined
          if (fresh) grantGone()
          else expired.value = true
        }
        message.value = failureMessage(result.failure)
        return
      }
      const normalized = normalizeGoogleEvents(result.items, window, timeZone)
      if (!normalized.ok) {
        record('events', 'format')
        message.value = { key: 'format', tone: 'error' }
        return
      }
      record('events', result.status)
      // Published only now, after every page arrived and every event was read: never part of the calendar.
      occurrences.value = normalized.occurrences
      coverage.value = { start: window.start, end: window.end, timeZone, fetchedAt: services.now().toISOString() }
      fromDevice.value = false
      publish()
      void saved.save(savedCopyOf({ workspaceId: document.workspaceId, plannerGeneration: document.generation, timeZone }, coverage.value, normalized.occurrences)).catch(() => undefined)
    } finally {
      inflight.delete(controller)
      if (isCurrent(ticket)) phase.value = 'idle'
    }
  }

  // "Connect" and "Update": with a live token the events are read again; otherwise Google is asked for a token, in
  // the same tap. Returns false when Google's script is not loaded yet (the caller opens the Connect sheet).
  function update(): boolean {
    if (phase.value !== 'idle') return true
    if (serverMode) {
      void (hasLiveToken() ? refresh(capture()) : mintAndRead(capture()))
      return true
    }
    if (hasLiveToken()) {
      void refresh(capture())
      return true
    }
    return requestToken()
  }

  function revokeWithin(value: string): Promise<'ok' | 'failed' | 'timeout'> {
    return new Promise((resolve) => {
      const deadline = setTimeout(() => resolve('timeout'), REVOKE_DEADLINE_MS)
      try {
        oauth2!.revoke(value, (result) => {
          clearTimeout(deadline)
          resolve(result?.successful === true ? 'ok' : 'failed')
        })
      } catch {
        clearTimeout(deadline)
        resolve('failed')
      }
    })
  }

  // Forgets locally first (here and in every other tab), then asks Google to withdraw the access. Only Google's own
  // confirmation is reported as a confirmed revocation.
  async function disconnect(): Promise<void> {
    if (serverMode) return disconnectServer()
    const live = hasLiveToken() ? token!.value : undefined
    forgetEverywhere()
    session.value = 'disconnected'
    if (!live || !oauth2) {
      record('revoke', 'noToken')
      message.value = { key: 'revokeUnconfirmed', tone: 'info', permissionsLink: true }
      return
    }
    phase.value = 'revoking'
    const disconnectedAt = generation.value
    const outcome = await revokeWithin(live)
    record('revoke', outcome)
    if (generation.value !== disconnectedAt) return
    phase.value = 'idle'
    message.value = outcome === 'ok'
      ? { key: 'revokeConfirmed', tone: 'ok' }
      : { key: 'revokeUnconfirmed', tone: 'info', permissionsLink: true }
  }

  function remainingMinutes(): number | undefined {
    return tokenExpiresAt.value === undefined ? undefined : Math.max(0, Math.floor((tokenExpiresAt.value - services.now().getTime()) / 60_000))
  }

  return {
    gis, phase, session, expired, fromDevice, generation, occurrences, coverage, message, diagnostics, busy, source, serverBuild, installedNote, lastServerCode,
    prepare, update, connect: connectServer, disconnect, forget, remainingMinutes, hasLiveToken,
  }
})
