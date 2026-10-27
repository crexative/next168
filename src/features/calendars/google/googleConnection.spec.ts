import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { createTestRepositories, newTestId } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { googleSnapshot } from '../googleCalendar'
import { EVENTS_READONLY, type GisOAuth2, type GisTokenClientConfig } from './gis'
import { configureGoogleServices, useGoogleConnection } from './useGoogleConnection'
import GoogleCalendarSection from './GoogleCalendarSection.vue'

// The connection store and its Settings section with Google and the network replaced (Slice 1 spec §4; acceptance
// A5 "nothing is published", A9 at the store level and A15).
const NOW = new Date('2026-10-20T12:00:00.000Z')
const TOKEN = 'tok-unit-SECRET-42'
const SECRETS = [TOKEN, 'evt-id-7f3a', 'evt-id-9c1b', 'Board meeting with Ana', 'ana@example.com', 'Quarterly review', 'Room 4', 'Calendar of ana@example.com']

const event = (id: string, summary: string, hour: number) => ({
  id, summary, start: { dateTime: `2026-10-21T${String(hour).padStart(2, '0')}:00:00Z` }, end: { dateTime: `2026-10-21T${String(hour + 1).padStart(2, '0')}:00:00Z` },
  attendees: [{ email: 'ana@example.com', self: false, responseStatus: 'accepted' }], description: 'Quarterly review', location: 'Room 4',
})
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

let tokenConfig: GisTokenClientConfig | undefined
// The client configuration behind each token request, in order: a request's answer goes to its own callback.
let requested: GisTokenClientConfig[] = []
let revoked: string[] = []
let respond: (url: string) => Response
const fakeGis: GisOAuth2 = {
  initTokenClient: (config) => { tokenConfig = config; return { requestAccessToken: () => { requested.push(config) } } },
  hasGrantedAllScopes: (response, ...scopes) => scopes.every((scope) => (response.scope ?? '').split(' ').includes(scope)),
  revoke: (token, done) => { revoked.push(token); done?.({ successful: true }) },
}
const fetchMock = vi.fn(async (url: string) => respond(url))

let app: App | undefined
let host: HTMLElement | undefined
let consoleSpies: MockInstance[] = []

beforeEach(async () => {
  tokenConfig = undefined
  requested = []
  revoked = []
  fetchMock.mockClear()
  respond = () => json({ items: [event('evt-id-7f3a', 'Board meeting with Ana', 9)] })
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: () => NOW, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  await usePlannerStore().load()
  configureGoogleServices({ clientId: '000000000000-unit.apps.googleusercontent.com', loadGis: async () => fakeGis, fetch: fetchMock as unknown as typeof fetch, now: () => NOW, channel: () => undefined })
  i18n.global.locale.value = 'en'
  consoleSpies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((method) => vi.spyOn(console, method))
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = undefined
  for (const spy of consoleSpies) spy.mockRestore()
  useGoogleConnection().forget()
})

async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) { await Promise.resolve(); await nextTick() }
}

async function connect(): Promise<ReturnType<typeof useGoogleConnection>> {
  const google = useGoogleConnection()
  google.prepare()
  await settle()
  expect(google.update()).toBe(true)
  tokenConfig!.callback({ access_token: TOKEN, expires_in: 3599, scope: EVENTS_READONLY, token_type: 'Bearer' })
  await vi.waitFor(() => expect(google.phase).toBe('idle'))
  return google
}

describe('useGoogleConnection', () => {
  it('asks Google for the read-only events scope only, without broadening or hinting an account', async () => {
    const google = useGoogleConnection()
    google.prepare()
    await settle()
    google.update()
    expect(tokenConfig).toMatchObject({ scope: EVENTS_READONLY, include_granted_scopes: false, prompt: '' })
    expect(tokenConfig).not.toHaveProperty('login_hint')
  })

  it('publishes a refresh only once every page arrived: a failed one leaves the previous events in place', async () => {
    const google = await connect()
    expect(googleSnapshot().occurrences.map((item) => item.uid)).toEqual(['evt-id-7f3a'])
    const revision = googleSnapshot().revision
    respond = (url) => {
      const page = Number(new URL(url).searchParams.get('pageToken')?.slice(1) ?? 1)
      return json({ items: [event('evt-id-9c1b', 'Quarterly review', 10)], nextPageToken: `p${page + 1}` })
    }
    fetchMock.mockClear()
    google.update()
    await vi.waitFor(() => expect(google.phase).toBe('idle'))
    expect(fetchMock).toHaveBeenCalledTimes(8)
    expect(google.message).toEqual({ key: 'tooMany', tone: 'error' })
    expect(googleSnapshot().revision).toBe(revision)
    expect(googleSnapshot().occurrences.map((item) => item.uid)).toEqual(['evt-id-7f3a'])
  })

  it('a malformed time fails the refresh and keeps the previous events', async () => {
    const google = await connect()
    respond = () => json({ items: [{ id: 'floating', start: { dateTime: '2026-10-21T09:00:00' }, end: { dateTime: '2026-10-21T10:00:00' } }] })
    google.update()
    await vi.waitFor(() => expect(google.phase).toBe('idle'))
    expect(google.message).toEqual({ key: 'format', tone: 'error' })
    expect(googleSnapshot().occurrences.map((item) => item.uid)).toEqual(['evt-id-7f3a'])
  })

  it('gives back a token that arrives after Disconnect, and reads nothing with it', async () => {
    const google = useGoogleConnection()
    google.prepare()
    await settle()
    google.update()
    await google.disconnect()
    tokenConfig!.callback({ access_token: 'tok-late', expires_in: 3599, scope: EVENTS_READONLY })
    await settle()
    expect(revoked).toEqual(['tok-late'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(googleSnapshot().occurrences).toEqual([])
  })

  it('gives back a token that arrives after the planner was replaced with the same workspace', async () => {
    const google = useGoogleConnection()
    google.prepare()
    await settle()
    google.update()
    const planner = usePlannerStore()
    await planner.commit((draft) => { draft.generation += 1 })
    tokenConfig!.callback({ access_token: 'tok-late', expires_in: 3599, scope: EVENTS_READONLY })
    await settle()
    expect(revoked).toEqual(['tok-late'])
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Review finding 1: a late answer to a request made before Disconnect or a planner replacement must not take the
  // place of a newer request, whichever arrives first.
  const lateBeforeNew = [
    ['Disconnect', async () => { await useGoogleConnection().disconnect() }],
    ['a planner replacement', async () => { await usePlannerStore().commit((draft) => { draft.generation += 1 }) }],
  ] as const
  for (const [what, invalidate] of lateBeforeNew) {
    for (const order of ['old answer first', 'new answer first'] as const) {
      it(`after ${what}, a reconnect keeps its own answer and the older one is given back (${order})`, async () => {
        const google = useGoogleConnection()
        google.prepare()
        await settle()
        google.update()
        await invalidate()
        await settle()
        expect(google.update()).toBe(true)
        expect(requested).toHaveLength(2)
        const [old, current] = requested as [GisTokenClientConfig, GisTokenClientConfig]
        const answer = (config: GisTokenClientConfig, token: string) => config.callback({ access_token: token, expires_in: 3599, scope: EVENTS_READONLY })
        if (order === 'old answer first') { answer(old, 'tok-OLD'); await settle(); answer(current, 'tok-NEW') } else { answer(current, 'tok-NEW'); await settle(); answer(old, 'tok-OLD') }
        await vi.waitFor(() => expect(google.phase).toBe('idle'))
        await settle()
        expect(revoked).toEqual(['tok-OLD'])
        expect(fetchMock).toHaveBeenCalledTimes(1)
        expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ Authorization: 'Bearer tok-NEW' })
        expect(googleSnapshot().occurrences.map((item) => item.uid)).toEqual(['evt-id-7f3a'])
      })
    }
  }

  // Review finding 3: coverage belongs to the zone it was read in.
  it('a planner time-zone change drops the events and their coverage, and a read for the old zone is not published', async () => {
    const google = await connect()
    expect(googleSnapshot().coverage).toMatchObject({ timeZone: 'UTC' })
    const planner = usePlannerStore()
    await planner.commit((draft) => { draft.settings.timeZone = 'America/Los_Angeles' })
    expect(googleSnapshot().coverage).toBeUndefined()
    expect(googleSnapshot().occurrences).toEqual([])
    let release!: () => void
    respond = () => json({ items: [event('evt-id-9c1b', 'Quarterly review', 10)] })
    fetchMock.mockImplementationOnce(async (url: string) => { await new Promise<void>((resolve) => { release = resolve }); return respond(url) })
    google.update()
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    await planner.commit((draft) => { draft.settings.timeZone = 'Asia/Tokyo' })
    release()
    await vi.waitFor(() => expect(google.phase).toBe('idle'))
    await settle()
    expect(googleSnapshot().coverage).toBeUndefined()
    expect(googleSnapshot().occurrences).toEqual([])
    google.update()
    await vi.waitFor(() => expect(googleSnapshot().coverage).toMatchObject({ timeZone: 'Asia/Tokyo' }))
  })

  it('does not keep a token without the events scope', async () => {
    const google = useGoogleConnection()
    google.prepare()
    await settle()
    google.update()
    tokenConfig!.callback({ access_token: 'tok-narrow', expires_in: 3599, scope: 'openid' })
    await settle()
    expect(revoked).toEqual(['tok-narrow'])
    expect(fetchMock).not.toHaveBeenCalled()
    expect(google.message).toEqual({ key: 'missingScope', tone: 'error' })
    expect(google.hasLiveToken()).toBe(false)
  })
})

describe('GoogleCalendarSection details', () => {
  it('show codes, counts and dates from memory, never an id, address, title, token or Google text, and nothing is logged', async () => {
    host = document.createElement('div')
    document.body.append(host)
    const pinia = createPinia()
    setActivePinia(pinia)
    configurePlannerStore({ repository: createTestRepositories().planner, now: () => NOW, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    await usePlannerStore().load()
    app = createApp(GoogleCalendarSection).use(pinia).use(i18n)
    app.mount(host)
    const google = await connect()
    respond = () => json({ error: { code: 403, message: 'Calendar of ana@example.com is not enabled', errors: [{ reason: 'accessNotConfigured', message: 'ana@example.com' }] } }, 403)
    google.update()
    await vi.waitFor(() => expect(google.phase).toBe('idle'))
    await settle()
    const details = host.querySelector('[data-testid=google-details]')!
    expect(details.textContent).toContain('403')
    expect(details.textContent).toContain('granted')
    expect(details.textContent).toContain('Events in memory1')
    expect(host.querySelector('[data-testid=google-message]')!.textContent).toContain('Google refused the read (accessNotConfigured).')
    const text = document.body.textContent ?? ''
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret)
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })
})
