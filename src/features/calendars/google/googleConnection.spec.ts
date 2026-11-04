import { IDBFactory } from 'fake-indexeddb'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { createTestRepositories, newTestId } from '@/repositories/testSupport'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { googleSnapshot } from '../googleCalendar'
import { IndexedDbSavedGoogleEvents, SAVED_GOOGLE_DATABASE } from '../googleSavedEvents'
import { EVENTS_READONLY, type GisOAuth2, type GisTokenClientConfig } from './gis'
import { configureGoogleServices, useGoogleConnection } from './useGoogleConnection'
import GoogleCalendarSection from './GoogleCalendarSection.vue'
import GoogleCoverageNotice from './GoogleCoverageNotice.vue'

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

// This device's IndexedDB: a new one per test, kept across the "reloads" inside a test.
let device: IDBFactory
let now = NOW
const loadGis = vi.fn(async () => fakeGis)

function configure(): void {
  configureGoogleServices({ clientId: '000000000000-unit.apps.googleusercontent.com', loadGis, fetch: fetchMock as unknown as typeof fetch, now: () => now, channel: () => undefined, saved: () => new IndexedDbSavedGoogleEvents(device) })
}

let app: App | undefined
let host: HTMLElement | undefined
let consoleSpies: MockInstance[] = []

beforeEach(async () => {
  tokenConfig = undefined
  requested = []
  revoked = []
  fetchMock.mockClear()
  respond = () => json({ items: [event('evt-id-7f3a', 'Board meeting with Ana', 9)] })
  device = new IDBFactory()
  now = NOW
  loadGis.mockClear()
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: () => NOW, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  await usePlannerStore().load()
  configure()
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
    expect(details.textContent).toContain('Events shown1')
    expect(host.querySelector('[data-testid=google-message]')!.textContent).toContain('Google refused the read (accessNotConfigured).')
    const text = document.body.textContent ?? ''
    for (const secret of SECRETS) expect(text, secret).not.toContain(secret)
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled()
  })
})

// The copy of the last complete read saved on this device (owner decision 2026-10-27): a reload shows it without
// Google, every deletion trigger removes it, and the token never reaches it.
describe('the copy saved on this device', () => {
  type Tab = { google: ReturnType<typeof useGoogleConnection>; planner: ReturnType<typeof usePlannerStore> }
  let storage: ReturnType<typeof createTestRepositories>

  // One more tab (or the same tab after a reload) on this device's planner storage and IndexedDB.
  async function openTab(channel?: () => ReturnType<GoogleChannel>): Promise<Tab> {
    setActivePinia(createPinia())
    const tab = createTestRepositories({ store: storage.store, legacy: storage.legacy, bus: storage.bus })
    configurePlannerStore({ repository: tab.planner, now: () => NOW, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const planner = usePlannerStore()
    await planner.load()
    configure()
    if (channel) configureGoogleServices({ clientId: '000000000000-unit.apps.googleusercontent.com', loadGis, fetch: fetchMock as unknown as typeof fetch, now: () => now, channel, saved: () => new IndexedDbSavedGoogleEvents(device) })
    return { google: useGoogleConnection(), planner }
  }

  async function onDevice(): Promise<string> {
    const db = await new Promise<IDBDatabase>((resolve) => { const open = device.open(SAVED_GOOGLE_DATABASE); open.onsuccess = () => resolve(open.result) })
    try {
      if (!db.objectStoreNames.contains('saved')) return ''
      return await new Promise<string>((resolve) => { const read = db.transaction('saved', 'readonly').objectStore('saved').getAll(); read.onsuccess = () => resolve(JSON.stringify(read.result)) })
    } finally {
      db.close()
    }
  }
  const saved = async () => (await onDevice()).includes('evt-id-7f3a')

  beforeEach(async () => {
    storage = createTestRepositories()
    setActivePinia(createPinia())
    configurePlannerStore({ repository: storage.planner, now: () => NOW, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const planner = usePlannerStore()
    await planner.load()
    // Stored, so every tab and every reload opens the same workspace and generation.
    await planner.commit((draft) => { draft.settings.weekStartsOn = 1 })
  })

  it('a reload shows the last complete read at once, marked as from this device, without loading Google or reading', async () => {
    const first = await openTab()
    await vi.waitFor(() => expect(first.google.coverage).toBeUndefined())
    await connect()
    await vi.waitFor(async () => expect(await saved()).toBe(true))
    const stored = await onDevice()
    for (const secret of [TOKEN, 'ana@example.com', 'Quarterly review', 'Room 4', EVENTS_READONLY]) expect(stored, secret).not.toContain(secret)
    loadGis.mockClear()
    fetchMock.mockClear()
    const { google } = await openTab()
    await vi.waitFor(() => expect(google.fromDevice).toBe(true))
    expect(googleSnapshot().occurrences.map((item) => item.uid)).toEqual(['evt-id-7f3a'])
    expect(google.session).toBe('connected')
    expect(google.coverage).toMatchObject({ timeZone: 'UTC', fetchedAt: NOW.toISOString() })
    expect(google.hasLiveToken()).toBe(false)
    expect(loadGis).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  // Review finding (Codex, 460bb3f): a long title of emoji or 𝔸 must not keep the whole read from being saved.
  it('a read whose titles are cut to 200 emoji or supplementary characters is saved and comes back', async () => {
    const long = `🌅 ${'𝔸'.repeat(300)}`
    respond = () => json({ items: [event('evt-id-7f3a', long, 9)] })
    await openTab()
    await connect()
    await vi.waitFor(async () => expect(await saved()).toBe(true))
    const { google } = await openTab()
    await vi.waitFor(() => expect(google.fromDevice).toBe(true))
    expect(google.occurrences[0]!.title).toBe([...long].slice(0, 200).join(''))
  })

  it('a refresh that fails saves nothing over the last complete read', async () => {
    await openTab()
    const google = await connect()
    await vi.waitFor(async () => expect(await saved()).toBe(true))
    respond = () => json({ items: [{ id: 'floating', start: { dateTime: '2026-10-21T09:00:00' }, end: { dateTime: '2026-10-21T10:00:00' } }] })
    google.update()
    await vi.waitFor(() => expect(google.phase).toBe('idle'))
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await onDevice()).toContain('evt-id-7f3a')
    expect(await onDevice()).not.toContain('floating')
  })

  const deletions: [string, (tab: Tab) => Promise<void>][] = [
    ['Disconnect', async ({ google }) => { await google.disconnect() }],
    ['Disconnect when Google refuses the revocation', async ({ google }) => {
      fakeGis.revoke = (token, done) => { revoked.push(token); done?.({ successful: false }) }
      try { await google.disconnect() } finally { fakeGis.revoke = (token, done) => { revoked.push(token); done?.({ successful: true }) } }
    }],
    ['a replaced planner (import, restore, Delete all data)', async ({ planner }) => { await planner.commit((draft) => { draft.generation += 1 }) }],
    ['another workspace', async ({ planner }) => { await planner.commit((draft) => { draft.workspaceId = 'ws-other' }) }],
    ['a new time zone', async ({ planner }) => { await planner.commit((draft) => { draft.settings.timeZone = 'America/Bogota' }) }],
    ['Google refusing access on the next request', async ({ google }) => {
      now = new Date(NOW.getTime() + 2 * 3_600_000)
      expect(google.update()).toBe(true)
      requested.at(-1)!.callback({ error: 'access_denied' } as never)
    }],
    ['a new token without the events permission', async ({ google }) => {
      now = new Date(NOW.getTime() + 2 * 3_600_000)
      google.update()
      requested.at(-1)!.callback({ access_token: 'tok-narrow', expires_in: 3599, scope: 'openid' })
    }],
    ['a 401 for a token Google has just granted', async ({ google }) => {
      now = new Date(NOW.getTime() + 2 * 3_600_000)
      respond = () => json({ error: { code: 401 } }, 401)
      google.update()
      requested.at(-1)!.callback({ access_token: 'tok-gone', expires_in: 3599, scope: EVENTS_READONLY })
      await vi.waitFor(() => expect(google.phase).toBe('idle'))
    }],
  ]
  for (const [trigger, run] of deletions) {
    it(`is deleted by ${trigger}, and a reload shows nothing`, async () => {
      const tab = await openTab()
      await connect()
      await vi.waitFor(async () => expect(await saved()).toBe(true))
      await run(tab)
      await vi.waitFor(async () => expect(await saved()).toBe(false))
      expect(googleSnapshot().occurrences).toEqual([])
      expect(tab.google.fromDevice).toBe(false)
      const reloaded = await openTab()
      await settle()
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(reloaded.google.coverage).toBeUndefined()
      expect(googleSnapshot().occurrences).toEqual([])
    })
  }

  for (const [what, status] of [['an expired token (401)', 401], ['a busy Google (429)', 429]] as const) {
    it(`stays after ${what} on a token from an earlier tap`, async () => {
      await openTab()
      const google = await connect()
      await vi.waitFor(async () => expect(await saved()).toBe(true))
      respond = () => json({ error: { code: status } }, status)
      google.update()
      await vi.waitFor(() => expect(google.phase).toBe('idle'))
      await new Promise((resolve) => setTimeout(resolve, 20))
      expect(await saved()).toBe(true)
      expect(googleSnapshot().occurrences.map((item) => item.uid)).toEqual(['evt-id-7f3a'])
    })
  }

  it('Disconnect in one tab clears the other tab, which saves its own next read', async () => {
    const listeners = new Set<(event: MessageEvent) => void>()
    const posted: unknown[] = []
    const bus: GoogleChannel = () => ({
      postMessage: (data: unknown) => { posted.push(data); for (const listener of [...listeners]) queueMicrotask(() => listener({ data } as MessageEvent)) },
      addEventListener: (_type: string, listener: (event: MessageEvent) => void) => { listeners.add(listener) },
    }) as unknown as ReturnType<GoogleChannel>
    const other = await openTab(bus)
    const otherGoogle = other.google
    const here = await openTab(bus)
    await connect()
    await vi.waitFor(async () => expect(await saved()).toBe(true))
    await here.google.disconnect()
    await vi.waitFor(async () => expect(await saved()).toBe(false))
    expect(posted).toEqual([{ type: 'forget', epoch: expect.stringMatching(/^[A-Za-z0-9-]{1,64}$/) }])
    expect(JSON.stringify(posted)).not.toContain(TOKEN)
    await vi.waitFor(() => expect(otherGoogle.session).toBe('disconnected'))
    // The other tab learned the new epoch from the message: its own next read is saved again.
    setActivePinia((otherGoogle as unknown as { _p: Parameters<typeof setActivePinia>[0] })._p)
    otherGoogle.prepare()
    await settle()
    expect(otherGoogle.update()).toBe(true)
    requested.at(-1)!.callback({ access_token: TOKEN, expires_in: 3599, scope: EVENTS_READONLY })
    await vi.waitFor(async () => expect(await saved()).toBe(true))
  })
})

type GoogleChannel = () => Pick<BroadcastChannel, 'postMessage' | 'addEventListener'> | undefined

describe('the line and the status for the saved copy', () => {
  async function mounted(component: Parameters<typeof createApp>[0], props: Record<string, unknown> = {}): Promise<HTMLElement> {
    host = document.createElement('div')
    document.body.append(host)
    const pinia = createPinia()
    setActivePinia(pinia)
    const storage = createTestRepositories()
    configurePlannerStore({ repository: storage.planner, now: () => NOW, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const planner = usePlannerStore()
    await planner.load()
    await planner.commit((draft) => { draft.settings.weekStartsOn = 1 })
    configure()
    await connect()
    await vi.waitFor(async () => expect(await new IndexedDbSavedGoogleEvents(device).loadMatching({ workspaceId: planner.document!.workspaceId, plannerGeneration: planner.document!.generation, timeZone: 'UTC' })).toBeDefined())
    // The reload.
    const reloaded = createPinia()
    setActivePinia(reloaded)
    configurePlannerStore({ repository: createTestRepositories({ store: storage.store, legacy: storage.legacy, bus: storage.bus }).planner, now: () => NOW, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    await usePlannerStore().load()
    configure()
    const google = useGoogleConnection()
    await vi.waitFor(() => expect(google.fromDevice).toBe(true))
    app = createApp(component, props).use(reloaded).use(i18n)
    app.mount(host)
    await settle()
    return host
  }

  afterEach(() => { vi.useRealTimers() })

  const WEEK = { ranges: [{ start: '2026-10-19', end: '2026-10-26' }] }
  for (const [hours, state, line, status] of [
    [3, 'saved', 'Google Calendar · updated 3 hr. ago', 'Updated 3 hr. ago · 1 event'],
    [49, 'stale', 'Google Calendar · updated 2 days ago. Your events might be out of date.', 'Updated 2 days ago · 1 event · May be out of date'],
  ] as const) {
    it(`${hours} h after the read, Week says "${line}" with Update, and Settings says the same`, async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(new Date(NOW.getTime() + hours * 3_600_000))
      const notice = await mounted(GoogleCoverageNotice, WEEK)
      const line_ = notice.querySelector('[data-testid=google-notice]')!
      expect(line_.getAttribute('data-state')).toBe(state)
      expect(line_.textContent!.replace(/ /g, ' ')).toContain(line)
      expect(line_.textContent).not.toContain("isn't loaded")
      expect(notice.querySelector('[data-testid=google-notice-update]')!.textContent).toContain('Update')
      app!.unmount()
      host!.remove()
      host = document.createElement('div')
      document.body.append(host)
      app = createApp(GoogleCalendarSection).use((useGoogleConnection() as unknown as { _p: Parameters<App['use']>[0] })._p).use(i18n)
      app.mount(host)
      await settle()
      expect(host.querySelector('[data-testid=google-status]')!.textContent!.replace(/ /g, ' ')).toBe(status)
      expect(host.querySelector('[data-testid=google-update]')!.textContent).toContain('Update')
      expect(host.querySelector('[data-testid=google-disconnect]')).not.toBeNull()
    })
  }
})
