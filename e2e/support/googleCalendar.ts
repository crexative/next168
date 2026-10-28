import { expect, type BrowserContext, type Page, type Route } from '@playwright/test'

// Google, faked at its real addresses. The GIS script is served at https://accounts.google.com/gsi/client, so the
// page's Content Security Policy applies to it as it would to Google's; the Calendar API is answered through
// context.route, which also sees requests the service worker makes. Any other request to a Google host is aborted
// and recorded, and `expectNoStrayGoogleTraffic` fails the test on it.

export const GIS_URL = 'https://accounts.google.com/gsi/client'
export const CALENDAR_API = 'https://www.googleapis.com/calendar/v3/'
export const EVENTS_READONLY = 'https://www.googleapis.com/auth/calendar.events.readonly'
export const SECRET_TOKEN = 'tok-SECRET-123'
const GOOGLE_HOST = /(^|\.)(google|googleapis|gstatic|googleusercontent)\.com$/

export interface GisRecord {
  configs: Record<string, unknown>[]
  requests: { active: boolean | null }[]
  revokes: string[]
  held: number
}

export interface GisPlan {
  // What the token callback receives; the default is a live token with the events scope.
  response?: Record<string, unknown>
  // An error_callback type instead of a token (popup_failed_to_open, popup_closed).
  error?: string
  // Keep the callback until the test calls releaseToken().
  hold?: boolean
  // revoke's answer: Google confirms, refuses, or never answers.
  revoke?: 'ok' | 'fail' | 'never'
}

// Runs in the page as Google's script. It records what the app asks of it.
function fakeGis(): void {
  type Callback = (response: Record<string, unknown>) => void
  const w = window as unknown as Record<string, unknown>
  const record = { configs: [] as Record<string, unknown>[], requests: [] as { active: boolean | null }[], revokes: [] as string[], held: [] as (() => void)[] }
  const plan = () => (w.__gisPlan ?? {}) as { response?: Record<string, unknown>; error?: string; hold?: boolean; revoke?: string }
  w.__gisRecord = record
  w.__gisRelease = () => { for (const respond of record.held.splice(0)) respond() }
  w.__gisReleaseFirst = () => { record.held.shift()?.() }
  w.google = {
    accounts: {
      oauth2: {
        initTokenClient(config: Record<string, unknown>) {
          const copy: Record<string, unknown> = {}
          for (const [key, value] of Object.entries(config)) copy[key] = typeof value === 'function' ? 'function' : value
          record.configs.push(copy)
          return {
            requestAccessToken() {
              const activation = (navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation
              record.requests.push({ active: activation ? activation.isActive : null })
              const current = plan()
              const respond = () => {
                if (current.error) (config.error_callback as (error: { type: string }) => void)({ type: current.error })
                else (config.callback as Callback)(current.response ?? { access_token: 'tok-SECRET-123', expires_in: 3599, scope: 'https://www.googleapis.com/auth/calendar.events.readonly', token_type: 'Bearer' })
              }
              if (current.hold) record.held.push(respond)
              else setTimeout(respond, 0)
            },
          }
        },
        hasGrantedAllScopes(response: { scope?: string }, ...scopes: string[]) {
          const granted = String(response.scope ?? '').split(' ')
          return scopes.every((scope) => granted.includes(scope))
        },
        revoke(token: string, done?: (result: Record<string, unknown>) => void) {
          record.revokes.push(token)
          const answer = plan().revoke ?? 'ok'
          if (answer === 'never') return
          setTimeout(() => done?.(answer === 'ok' ? { successful: true } : { successful: false, error: 'invalid_token' }), 0)
        },
      },
    },
  }
}

export const FAKE_GIS_SOURCE = `(${fakeGis.toString()})()`

export interface CalendarEvent { id: string; summary?: string; start: Record<string, string>; end: Record<string, string>; [key: string]: unknown }

// The mock answers with what Google would never send under `fields`, so a leak would show.
export function withPrivateFields(event: CalendarEvent): CalendarEvent {
  return {
    ...event,
    attendees: [{ email: 'ana.private@example.com', responseStatus: 'accepted' }, { email: 'owner@example.com', self: true, responseStatus: 'accepted' }],
    description: 'Secret agenda description',
    location: 'Hidden Office 42',
    hangoutLink: 'https://meet.google.com/aaa-bbbb-ccc',
  }
}

export interface GoogleFake {
  gisLoads: number
  apiRequests: URL[]
  stray: string[]
  events: CalendarEvent[]
  // An answer other than the events list, for the next API requests.
  apiStatus?: { status: number; body: unknown }
  holdApi(): () => void
}

export async function fakeGoogle(context: BrowserContext, options: { gisDelayMs?: number; events?: CalendarEvent[] } = {}): Promise<GoogleFake> {
  let held: Promise<void> | undefined
  const fake: GoogleFake = {
    gisLoads: 0,
    apiRequests: [],
    stray: [],
    events: options.events ?? [],
    holdApi() {
      let release!: () => void
      held = new Promise<void>((resolve) => { release = resolve })
      return () => { held = undefined; release() }
    },
  }
  await context.route((url) => GOOGLE_HOST.test(url.hostname), async (route: Route) => {
    const request = route.request()
    const href = request.url()
    if (href === GIS_URL) {
      fake.gisLoads += 1
      if (options.gisDelayMs) await new Promise((resolve) => setTimeout(resolve, options.gisDelayMs))
      await route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_GIS_SOURCE })
      return
    }
    if (href.startsWith(CALENDAR_API)) {
      const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization', 'access-control-allow-methods': 'GET' }
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return }
      fake.apiRequests.push(new URL(href))
      const wait = held
      if (wait) await wait
      const answer = fake.apiStatus ?? { status: 200, body: { items: fake.events } }
      await route.fulfill({ status: answer.status, headers: { ...cors, 'content-type': 'application/json' }, body: JSON.stringify(answer.body) }).catch(() => undefined)
      return
    }
    fake.stray.push(href)
    await route.abort()
  })
  return fake
}

export function expectNoStrayGoogleTraffic(fake: GoogleFake): void {
  expect(fake.stray, 'requests to Google hosts that the app must not make').toEqual([])
}

export async function setGisPlan(page: Page, plan: GisPlan): Promise<void> {
  await page.evaluate((next) => { (window as unknown as { __gisPlan: unknown }).__gisPlan = next }, plan)
}

export async function gisRecord(page: Page): Promise<GisRecord> {
  return page.evaluate(() => {
    const record = (window as unknown as { __gisRecord?: { configs: Record<string, unknown>[]; requests: { active: boolean | null }[]; revokes: string[]; held: unknown[] } }).__gisRecord
    return record ? { configs: record.configs, requests: record.requests, revokes: record.revokes, held: record.held.length } : { configs: [], requests: [], revokes: [], held: 0 }
  })
}

export async function releaseToken(page: Page, which: 'all' | 'first' = 'all'): Promise<void> {
  await page.evaluate((only) => {
    const fake = window as unknown as { __gisRelease: () => void; __gisReleaseFirst: () => void }
    if (only === 'first') fake.__gisReleaseFirst()
    else fake.__gisRelease()
  }, which)
}

// The database that holds the copy of the last Google Calendar read (src/features/calendars/googleSavedEvents.ts).
export const SAVED_GOOGLE_DATABASE = 'next168-google'

// Every place the app could write to on this origin, serialised: key-value storage, every IndexedDB database's
// records and keys (except `skipDatabase`), and every Cache Storage entry (address and body).
export async function everythingStored(page: Page, skipDatabase?: string): Promise<string> {
  return page.evaluate(async (skip) => {
    const parts: string[] = []
    for (const storage of [localStorage, sessionStorage]) {
      for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index)!
        parts.push(key, storage.getItem(key) ?? '')
      }
    }
    for (const info of await indexedDB.databases()) {
      if (!info.name || info.name === skip) continue
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(info.name!)
        open.onsuccess = () => resolve(open.result)
        open.onerror = () => reject(open.error)
      })
      for (const name of Array.from(db.objectStoreNames)) {
        const store = db.transaction(name, 'readonly').objectStore(name)
        const [values, keys] = await Promise.all([
          new Promise<unknown[]>((resolve) => { const read = store.getAll(); read.onsuccess = () => resolve(read.result) }),
          new Promise<unknown[]>((resolve) => { const read = store.getAllKeys(); read.onsuccess = () => resolve(read.result) }),
        ])
        parts.push(info.name, name, JSON.stringify(keys), JSON.stringify(values))
      }
      db.close()
    }
    if ('caches' in window) {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        for (const request of await cache.keys()) {
          parts.push(request.url, await (await cache.match(request))?.clone().text().catch(() => '') ?? '')
        }
      }
    }
    return parts.join('\n')
  }, skipDatabase)
}

// The saved copy's records, serialised; '' when its database does not exist (reading never creates it).
export async function savedGoogleCopy(page: Page): Promise<string> {
  return page.evaluate(async (name) => {
    if (!(await indexedDB.databases()).some((info) => info.name === name)) return ''
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const open = indexedDB.open(name)
      open.onsuccess = () => resolve(open.result)
      open.onerror = () => reject(open.error)
    })
    try {
      if (!db.objectStoreNames.contains('saved')) return ''
      const store = db.transaction('saved', 'readonly').objectStore('saved')
      return await new Promise<string>((resolve) => { const read = store.getAll(); read.onsuccess = () => resolve(JSON.stringify(read.result)) })
    } finally {
      db.close()
    }
  }, SAVED_GOOGLE_DATABASE)
}

export async function cachedUrls(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const names = await caches.keys()
    const keys = await Promise.all(names.map(async (name) => (await (await caches.open(name)).keys()).map((request) => request.url)))
    return keys.flat()
  })
}
