import { defineStore } from 'pinia'
import { computed, reactive, ref, shallowRef, watch } from 'vue'
import type { ExternalOccurrence } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import { publishGoogleSnapshot, type DateWindow, type GoogleCoverage } from '../googleCalendar'
import { EVENTS_READONLY, type GisErrorResponse, type GisOAuth2, type GisTokenClient, type GisTokenResponse } from './gis'
import { loadGis } from './gisLoader'
import { fetchPrimaryEvents, type GoogleFailure } from './googleApi'
import { normalizeGoogleEvents } from './googleNormalize'

// The Google Calendar connection of this tab. The token and the events live in memory only: nothing here is written
// to localStorage, IndexedDB, Cache Storage or the console, and a reload starts from nothing.

export const REVOKE_DEADLINE_MS = 10_000
// A token is treated as expired a minute early, so a request never starts with one about to lapse.
const EXPIRY_MARGIN_MS = 60_000
const PAST_DAYS = 7
const FUTURE_DAYS = 42
const DAY_MS = 86_400_000
export const FORGET_CHANNEL = 'next168-google'
export const PERMISSIONS_URL = 'https://myaccount.google.com/connections'
const ERROR_CODE = /^[A-Za-z_]{1,40}$/

export interface GoogleServices {
  clientId: string
  loadGis(): Promise<GisOAuth2>
  fetch: typeof fetch
  now(): Date
  channel(): Pick<BroadcastChannel, 'postMessage' | 'addEventListener'> | undefined
}

function defaultServices(): GoogleServices {
  return {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
    loadGis: () => loadGis(),
    fetch: (...args) => globalThis.fetch(...args),
    now: () => new Date(),
    channel: () => (typeof BroadcastChannel === 'function' ? new BroadcastChannel(FORGET_CHANNEL) : undefined),
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
  // 'new' until a connection succeeds in this tab; 'disconnected' after Disconnect here or in another tab.
  const session = ref<'new' | 'connected' | 'disconnected'>('new')
  // A 401 dropped the token while events are still shown: the next tap asks Google again.
  const expired = ref(false)
  const generation = ref(0)
  const occurrences = shallowRef<ExternalOccurrence[]>([])
  const coverage = ref<GoogleCoverage | undefined>()
  const message = ref<GoogleMessage | null>(null)
  const tokenExpiresAt = ref<number | undefined>()
  const diagnostics = reactive<{ scopeGranted?: boolean; last: Partial<Record<DiagnosticKind, DiagnosticEntry>> }>({ last: {} })

  // Never reactive, never exposed: the access token.
  let token: { value: string; expiresAt: number } | undefined
  let oauth2: GisOAuth2 | undefined
  let client: GisTokenClient | undefined
  let pending: Ticket | undefined
  const inflight = new Set<AbortController>()

  const hasLiveToken = () => token !== undefined && token.expiresAt > services.now().getTime()
  const busy = computed(() => phase.value !== 'idle')

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
    pending = undefined
    expired.value = false
    occurrences.value = []
    coverage.value = undefined
    phase.value = 'idle'
    publish()
  }

  // A replaced planner (Delete all data, an import or a restore, here or in another tab) is a new owner: what was
  // read for the old one goes.
  watch(() => `${planner.document?.workspaceId}\u0000${planner.document?.generation}`, (next, previous) => {
    if (next !== previous) forget()
  }, { flush: 'sync' })

  const channel = services.channel()
  channel?.addEventListener('message', (event: MessageEvent) => {
    if ((event.data as { type?: unknown } | null)?.type !== 'forget') return
    forget()
    session.value = 'disconnected'
    message.value = null
  })

  function onToken(response: GisTokenResponse): void {
    const ticket = pending
    pending = undefined
    if (response.error) {
      record('token', safeCode(response.error))
      if (isCurrent(ticket)) {
        phase.value = 'idle'
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
    void refresh(ticket)
  }

  function onTokenError(error: GisErrorResponse): void {
    const ticket = pending
    pending = undefined
    record('token', safeCode(error?.type))
    if (!isCurrent(ticket)) return
    phase.value = 'idle'
    if (error?.type === 'popup_failed_to_open') message.value = { key: 'popupBlocked', tone: 'error', params: { host: globalThis.location?.host ?? '' } }
  }

  // Loads Google's script when the Connect sheet opens; the button waits for it, so the tap itself never waits.
  function prepare(): void {
    if (gis.value === 'loading' || gis.value === 'ready') return
    gis.value = 'loading'
    if (message.value?.key === 'gisLoad') message.value = null
    services.loadGis().then((api) => {
      oauth2 = api
      client = api.initTokenClient({
        client_id: services.clientId,
        scope: EVENTS_READONLY,
        include_granted_scopes: false,
        prompt: '',
        callback: onToken,
        error_callback: onTokenError,
      })
      gis.value = 'ready'
    }, () => {
      gis.value = 'failed'
      record('token', 'gisLoad')
      message.value = { key: 'gisLoad', tone: 'error' }
    })
  }

  // Must run synchronously inside the click: Google opens its window only from a user gesture.
  function requestToken(): boolean {
    if (!client || phase.value !== 'idle') return false
    pending = capture()
    phase.value = 'authorizing'
    message.value = null
    client.requestAccessToken()
    return true
  }

  async function refresh(ticket: Ticket): Promise<void> {
    const current = token
    const document = planner.document
    if (!current || !document || !isCurrent(ticket)) return
    const timeZone = document.settings.timeZone
    const window = fetchWindow(services.now(), timeZone)
    const controller = new AbortController()
    inflight.add(controller)
    phase.value = 'fetching'
    message.value = null
    try {
      const result = await fetchPrimaryEvents({ token: current.value, timeMin: window.timeMin, timeMax: window.timeMax, signal: controller.signal, request: services.fetch })
      if (!isCurrent(ticket)) return
      if (!result.ok) {
        record('events', result.status ?? result.failure.code)
        if (result.failure.code === 'expired') {
          token = undefined
          tokenExpiresAt.value = undefined
          expired.value = true
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
      coverage.value = { start: window.start, end: window.end, fetchedAt: services.now().toISOString() }
      publish()
    } finally {
      inflight.delete(controller)
      if (isCurrent(ticket)) phase.value = 'idle'
    }
  }

  // "Connect" and "Update": with a live token the events are read again; otherwise Google is asked for a token, in
  // the same tap. Returns false when Google's script is not loaded yet (the caller opens the Connect sheet).
  function update(): boolean {
    if (phase.value !== 'idle') return true
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
    const live = hasLiveToken() ? token!.value : undefined
    forget()
    session.value = 'disconnected'
    channel?.postMessage({ type: 'forget' })
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
    gis, phase, session, expired, generation, occurrences, coverage, message, diagnostics, busy,
    prepare, update, disconnect, forget, remainingMinutes, hasLiveToken,
  }
})
