// Reads the primary calendar's events for one window, page by page. Only the fields Weeklid shows are requested
// (`fields`), so guests' addresses, descriptions, locations and meeting links never reach the device.

export const EVENTS_URL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
export const EVENT_FIELDS = 'nextPageToken,items(id,status,summary,start,end,transparency,eventType,attendees(self,responseStatus),recurringEventId,originalStartTime)'
export const PAGE_SIZE = 250
export const MAX_PAGES = 8
export const REQUEST_DEADLINE_MS = 15_000

const RATE_LIMIT_REASONS = new Set(['rateLimitExceeded', 'userRateLimitExceeded'])
// A reason is shown and kept only as Google's short code (for example `accessNotConfigured`), never as free text.
const REASON_CODE = /^[A-Za-z_]{1,64}$/

export type GoogleFailure =
  | { code: 'expired' }
  | { code: 'busy' }
  | { code: 'denied'; reason: string }
  | { code: 'server'; status: number }
  | { code: 'network' }
  | { code: 'timeout' }
  | { code: 'tooMany' }
  | { code: 'malformed' }
  | { code: 'aborted' }

export type EventsResult =
  | { ok: true; items: unknown[]; status: number }
  | { ok: false; failure: GoogleFailure; status?: number }

export interface EventsRequest {
  token: string
  timeMin: string
  timeMax: string
  signal: AbortSignal
  request?: typeof fetch
}

export function eventsUrl(timeMin: string, timeMax: string, pageToken?: string): string {
  const params = new URLSearchParams({
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: String(PAGE_SIZE),
    timeMin,
    timeMax,
    fields: EVENT_FIELDS,
  })
  if (pageToken) params.set('pageToken', pageToken)
  return `${EVENTS_URL}?${params}`
}

type Page = { ok: true; items: unknown[]; nextPageToken?: string; status: number } | { ok: false; failure: GoogleFailure; status?: number }

async function reasonOf(response: Response): Promise<string> {
  try {
    const body = await response.json() as { error?: { errors?: { reason?: unknown }[]; status?: unknown } }
    const reason = body?.error?.errors?.[0]?.reason ?? body?.error?.status
    return typeof reason === 'string' && REASON_CODE.test(reason) ? reason : 'unknown'
  } catch {
    return 'unknown'
  }
}

async function requestPage(url: string, { token, signal, request = globalThis.fetch.bind(globalThis) }: EventsRequest): Promise<Page> {
  const controller = new AbortController()
  let timedOut = false
  const deadline = setTimeout(() => { timedOut = true; controller.abort() }, REQUEST_DEADLINE_MS)
  const cancel = () => controller.abort()
  if (signal.aborted) controller.abort()
  signal.addEventListener('abort', cancel, { once: true })
  const interrupted = (): Page => ({ ok: false, failure: { code: timedOut ? 'timeout' : signal.aborted ? 'aborted' : 'network' } })
  try {
    let response: Response
    try {
      response = await request(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      })
    } catch {
      return interrupted()
    }
    const status = response.status
    if (status === 401) return { ok: false, failure: { code: 'expired' }, status }
    if (status === 429) return { ok: false, failure: { code: 'busy' }, status }
    if (status === 403) {
      const reason = await reasonOf(response)
      return { ok: false, failure: RATE_LIMIT_REASONS.has(reason) ? { code: 'busy' } : { code: 'denied', reason }, status }
    }
    if (!response.ok) return { ok: false, failure: { code: 'server', status }, status }
    let body: unknown
    try {
      body = await response.json()
    } catch {
      return timedOut || signal.aborted ? interrupted() : { ok: false, failure: { code: 'malformed' }, status }
    }
    const page = body as { items?: unknown; nextPageToken?: unknown }
    if (!page || typeof page !== 'object' || (page.items !== undefined && !Array.isArray(page.items)) || (page.nextPageToken !== undefined && typeof page.nextPageToken !== 'string')) {
      return { ok: false, failure: { code: 'malformed' }, status }
    }
    return { ok: true, items: (page.items as unknown[] | undefined) ?? [], ...(page.nextPageToken ? { nextPageToken: page.nextPageToken as string } : {}), status }
  } finally {
    clearTimeout(deadline)
    signal.removeEventListener('abort', cancel)
  }
}

// All pages or nothing: a window that needs more than MAX_PAGES pages fails as `tooMany` instead of showing part of
// the calendar as if it were all of it. No automatic retry: a busy Google is reported, not hammered.
export async function fetchPrimaryEvents(input: EventsRequest): Promise<EventsResult> {
  const items: unknown[] = []
  let pageToken: string | undefined
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const result = await requestPage(eventsUrl(input.timeMin, input.timeMax, pageToken), input)
    if (!result.ok) return result
    items.push(...result.items)
    if (!result.nextPageToken) return { ok: true, items, status: result.status }
    pageToken = result.nextPageToken
  }
  return { ok: false, failure: { code: 'tooMany' } }
}
