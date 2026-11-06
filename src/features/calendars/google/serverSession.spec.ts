import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createTestRepositories, newTestId } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { googleSnapshot } from '../googleCalendar'
import { captureGoogleReturn, takeGoogleReturn } from '../googleGate'
import { memoryOnlySavedEvents } from '../googleSavedEvents'
import { configureGoogleServices, useGoogleConnection, type GoogleMessage } from './useGoogleConnection'
import type { ForgetOutcome, MintResult, ConnectResult, ServerConnection } from './serverConnection'

// A-1: each answer of the Weeklid server, mapped to the state and message the person sees (design 2.3, 2.4, 3). The
// connection to the server is a fake here; its mapping of real replies is pinned by server/google/clientContract.spec.ts.
const NOW = new Date('2026-10-20T12:00:00.000Z')
const TOKEN = 'tok-unit-SECRET-42'
const eventsResponse = () => new Response(JSON.stringify({ items: [{ id: 'evt-1', summary: 'Standup', start: { dateTime: '2026-10-21T09:00:00Z' }, end: { dateTime: '2026-10-21T10:00:00Z' } }] }), { status: 200 })
const TOKEN_OK: MintResult = { kind: 'token', accessToken: TOKEN, expiresIn: 3599 }

let mint: MintResult[]
let forget: ForgetOutcome
let connect: ConnectResult
let online: boolean
let clock: Date
let navigated: string[]
const calls = { mint: 0, connect: 0, forget: [] as boolean[] }
const events = vi.fn(async () => eventsResponse())

const fakeServer: ServerConnection = {
  mint: async () => { calls.mint += 1; return mint.shift() ?? mint[0] ?? TOKEN_OK },
  connect: async () => { calls.connect += 1; return connect },
  forgetThisDevice: async (revoke) => { calls.forget.push(revoke); return forget },
}

async function start(source: 'server' | 'gis' = 'server') {
  setActivePinia(createPinia())
  configurePlannerStore({ repository: createTestRepositories().planner, now: () => NOW, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  await usePlannerStore().load()
  configureGoogleServices({
    clientId: '000000000000-unit.apps.googleusercontent.com',
    fetch: events as unknown as typeof fetch,
    now: () => clock,
    channel: () => undefined,
    saved: () => memoryOnlySavedEvents,
    source,
    server: async () => fakeServer,
    online: () => online,
    navigate: (url) => { navigated.push(url) },
  })
  return useGoogleConnection()
}

async function settle(google: ReturnType<typeof useGoogleConnection>): Promise<void> {
  await vi.waitFor(() => expect(google.phase).toBe('idle'))
  await nextTick()
}

beforeEach(() => {
  mint = [TOKEN_OK]
  forget = 'confirmed'
  connect = { kind: 'url', url: 'https://accounts.google.com/o/oauth2/v2/auth?state=x' }
  online = true
  clock = NOW
  navigated = []
  calls.mint = 0
  calls.connect = 0
  calls.forget = []
  events.mockClear()
  takeGoogleReturn()
})
afterEach(() => { useGoogleConnection().forget() })

const message = (google: ReturnType<typeof useGoogleConnection>): GoogleMessage | null => google.message

describe('A-1 opening the app', () => {
  it('a token → connected, events read once with it, no message', async () => {
    const google = await start()
    await settle(google)
    expect(google.session).toBe('connected')
    expect(calls.mint).toBe(1)
    expect(events).toHaveBeenCalledTimes(1)
    expect((events.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: `Bearer ${TOKEN}` })
    expect(googleSnapshot().occurrences.map((item) => item.uid)).toEqual(['evt-1'])
    expect(message(google)).toBeNull()
    expect(google.lastServerCode).toBe('ok')
  })

  it.each(['noDevice', 'notConnected', 'reconnect'] as const)('a 401 %s → disconnected, Connect shown, no message', async (code) => {
    mint = [{ kind: 'signedOut', code }]
    const google = await start()
    await settle(google)
    expect(google.session).toBe('disconnected')
    expect(message(google)).toBeNull()
    expect(events).not.toHaveBeenCalled()
    expect(google.lastServerCode).toBe(code)
  })

  it.each([
    ['disabled', 'serverPaused'],
    ['notConfigured', 'serverPaused'],
  ] as const)('paused (%s) → unavailable, %s', async (code, key) => {
    mint = [{ kind: 'paused', code }]
    const google = await start()
    await settle(google)
    expect(google.session).toBe('unavailable')
    expect(message(google)).toMatchObject({ key })
  })

  it.each(['network', 'timeout', 'storage', 'googleUnavailable', 'malformed', 'busy', 'error'] as const)('%s → unavailable, serverUnavailable; Update retries', async (code) => {
    mint = [{ kind: 'unavailable', code }, TOKEN_OK]
    const google = await start()
    await settle(google)
    expect(google.session).toBe('unavailable')
    expect(message(google)).toEqual({ key: 'serverUnavailable', tone: 'error' })
    expect(google.update()).toBe(true)
    await vi.waitFor(() => expect(google.session).toBe('connected'))
    await settle(google)
    expect(message(google)).toBeNull()
  })

  it('a browser without the lock → lockUnavailable', async () => {
    mint = [{ kind: 'unavailable', code: 'lockUnavailable' }]
    const google = await start()
    await settle(google)
    expect(message(google)).toEqual({ key: 'lockUnavailable', tone: 'error' })
  })

  it('offline → no request at all, unavailable; Update retries once online', async () => {
    online = false
    const google = await start()
    await settle(google)
    expect(calls.mint).toBe(0)
    expect(google.session).toBe('unavailable')
    expect(googleSnapshot().occurrences).toEqual([])
    online = true
    google.update()
    await vi.waitFor(() => expect(google.session).toBe('connected'))
    await settle(google)
    expect(googleSnapshot().occurrences).toHaveLength(1)
  })

  it('a 401 on a later Update in a tab that was connected → disconnected with reconnectNeeded, events dropped', async () => {
    const google = await start()
    await settle(google)
    clock = new Date(NOW.getTime() + 2 * 3600_000)
    mint = [{ kind: 'signedOut', code: 'notConnected' }]
    google.update()
    await settle(google)
    expect(google.session).toBe('disconnected')
    expect(message(google)).toEqual({ key: 'reconnectNeeded', tone: 'info' })
    expect(googleSnapshot().occurrences).toEqual([])
  })
})

describe('A-1 coming back from Google', () => {
  const back = (result: string) => captureGoogleReturn({ href: `https://weeklid.crexative.com/?google=${result}#/settings/calendars` }, { replaceState: () => undefined })

  it('connected adds no message', async () => {
    back('connected')
    const google = await start()
    await settle(google)
    expect(google.session).toBe('connected')
    expect(message(google)).toBeNull()
  })

  it.each([
    ['denied', { key: 'accessDenied', tone: 'info' }],
    ['disabled', { key: 'serverPaused', tone: 'info' }],
    ['exchange', { key: 'connectFailed', tone: 'error', params: { code: 'exchange' } }],
    ['cancelled', { key: 'connectFailed', tone: 'error', params: { code: 'cancelled' } }],
  ])('%s adds its message', async (result, expected) => {
    mint = [{ kind: 'signedOut', code: 'notConnected' }]
    back(result)
    const google = await start()
    await vi.waitFor(() => expect(message(google)).toEqual(expected))
  })

  it('an unknown result is ignored', async () => {
    mint = [{ kind: 'signedOut', code: 'notConnected' }]
    back('<script>')
    const google = await start()
    await settle(google)
    expect(message(google)).toBeNull()
  })
})

describe('A-1 Connect', () => {
  it('asks the server and sends the whole page to the address it returned; GIS is never loaded', async () => {
    mint = [{ kind: 'signedOut', code: 'notConnected' }]
    const google = await start()
    await settle(google)
    await google.connect()
    expect(navigated).toEqual(['https://accounts.google.com/o/oauth2/v2/auth?state=x'])
    expect(google.gis).toBe('idle')
    google.prepare()
    expect(google.gis).toBe('idle')
  })

  it.each([
    [{ kind: 'paused', code: 'disabled' }, { key: 'serverPaused', tone: 'info' }],
    [{ kind: 'unavailable', code: 'storage' }, { key: 'serverUnavailable', tone: 'error' }],
    [{ kind: 'unavailable', code: 'lockUnavailable' }, { key: 'lockUnavailable', tone: 'error' }],
  ] as [ConnectResult, GoogleMessage][])('%j → %j and no navigation', async (result, expected) => {
    mint = [{ kind: 'signedOut', code: 'notConnected' }]
    const google = await start()
    await settle(google)
    connect = result
    await google.connect()
    expect(navigated).toEqual([])
    expect(message(google)).toEqual(expected)
    expect(google.phase).toBe('idle')
  })

  it('offline → no request', async () => {
    mint = [{ kind: 'signedOut', code: 'notConnected' }]
    const google = await start()
    await settle(google)
    online = false
    await google.connect()
    expect(calls.connect).toBe(0)
    expect(navigated).toEqual([])
  })
})

describe('A-1 Disconnect', () => {
  it.each([
    ['confirmed', { key: 'revokeConfirmed', tone: 'ok' }],
    ['unconfirmed', { key: 'revokeUnconfirmedServer', tone: 'info', permissionsLink: true }],
    ['cleared', { key: 'revokeUnconfirmedServer', tone: 'info', permissionsLink: true }],
    ['mayRemain', { key: 'googleAccessMayRemain', tone: 'info', permissionsLink: true, topLevel: true }],
  ] as [ForgetOutcome, GoogleMessage][])('%s → disconnected in memory, with its message', async (outcome, expected) => {
    const google = await start()
    await settle(google)
    forget = outcome
    await google.disconnect()
    expect(calls.forget).toEqual([true])
    expect(google.session).toBe('disconnected')
    expect(googleSnapshot().occurrences).toEqual([])
    expect(message(google)).toEqual(expected)
  })

  it('no terminal answer → still connected, events kept, disconnectFailed', async () => {
    const google = await start()
    await settle(google)
    forget = 'failed'
    await google.disconnect()
    expect(google.session).toBe('connected')
    expect(googleSnapshot().occurrences).toHaveLength(1)
    expect(message(google)).toEqual({ key: 'disconnectFailed', tone: 'error' })
    expect(google.phase).toBe('idle')
  })

  it('offline → nothing is sent and nothing is forgotten', async () => {
    const google = await start()
    await settle(google)
    online = false
    await google.disconnect()
    expect(calls.forget).toEqual([])
    expect(google.session).toBe('connected')
  })

  it('a token reply that arrives after Disconnect is dropped: nothing is read and nothing is shown', async () => {
    const google = await start()
    await settle(google)
    clock = new Date(NOW.getTime() + 2 * 3600_000)
    let release!: () => void
    const held = new Promise<void>((resolve) => { release = resolve })
    mint = [TOKEN_OK]
    const mintOnce = fakeServer.mint
    let answered = false
    fakeServer.mint = async () => { await held; const result = await mintOnce(); answered = true; return result }
    google.update()
    await vi.waitFor(() => expect(google.phase).toBe('fetching'))
    forget = 'confirmed'
    google.forget()
    await google.disconnect()
    events.mockClear()
    release()
    await vi.waitFor(() => expect(answered).toBe(true))
    await new Promise((resolve) => setTimeout(resolve, 20))
    fakeServer.mint = mintOnce
    expect(events).not.toHaveBeenCalled()
    expect(google.session).toBe('disconnected')
    expect(googleSnapshot().occurrences).toEqual([])
    expect(google.hasLiveToken()).toBe(false)
  })
})

describe('the Google source in a server build', () => {
  it('GIS source never asks the server, and keeps nothing on the device', async () => {
    const google = await start('gis')
    await nextTick()
    expect(calls.mint).toBe(0)
    expect(google.source).toBe('gis')
  })
})
