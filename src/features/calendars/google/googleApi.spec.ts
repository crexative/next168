import { afterEach, describe, expect, it, vi } from 'vitest'
import { EVENT_FIELDS, EVENTS_URL, MAX_PAGES, REQUEST_DEADLINE_MS, fetchPrimaryEvents } from './googleApi'

// The Calendar API request contract (Slice 1 spec §4 "Fetch", acceptance A5).
const TIME_MIN = '2026-10-11T00:00:00.000Z'
const TIME_MAX = '2026-12-01T00:00:00.000Z'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const item = (id: string) => ({ id, start: { dateTime: '2026-10-20T10:00:00Z' }, end: { dateTime: '2026-10-20T11:00:00Z' } })

function pages(count: number, lastHasToken = false) {
  return vi.fn(async (url: string) => {
    const token = new URL(url).searchParams.get('pageToken')
    const page = token ? Number(token.slice(1)) : 1
    const next = page < count || (page === count && lastHasToken) ? { nextPageToken: `p${page + 1}` } : {}
    return json({ items: [item(`e${page}`)], ...next })
  })
}

const run = (request: typeof fetch, signal = new AbortController().signal) => fetchPrimaryEvents({ token: 'tok-unit', timeMin: TIME_MIN, timeMax: TIME_MAX, signal, request })

afterEach(() => { vi.useRealTimers() })

describe('fetchPrimaryEvents', () => {
  it('asks for the primary calendar with exactly the specified parameters, fields and request options', async () => {
    const request = pages(1)
    const result = await run(request as unknown as typeof fetch)
    expect(result).toEqual({ ok: true, items: [item('e1')], status: 200 })
    expect(request).toHaveBeenCalledTimes(1)
    const [url, init] = request.mock.calls[0] as unknown as [string, RequestInit]
    const parsed = new URL(url)
    expect(`${parsed.origin}${parsed.pathname}`).toBe(EVENTS_URL)
    expect(EVENTS_URL).toBe('https://www.googleapis.com/calendar/v3/calendars/primary/events')
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      singleEvents: 'true', orderBy: 'startTime', maxResults: '250', timeMin: TIME_MIN, timeMax: TIME_MAX,
      fields: 'nextPageToken,items(id,status,summary,start,end,transparency,eventType,attendees(self,responseStatus),recurringEventId,originalStartTime)',
    })
    expect(EVENT_FIELDS).not.toMatch(/email|description|location|hangoutLink|conferenceData|creator|organizer/)
    expect(init).toMatchObject({ method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer' })
    expect(init.headers).toEqual({ Authorization: 'Bearer tok-unit' })
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('follows page tokens and succeeds with exactly eight complete pages', async () => {
    expect(MAX_PAGES).toBe(8)
    const request = pages(8)
    const result = await run(request as unknown as typeof fetch)
    expect(result.ok && result.items.map((entry) => (entry as { id: string }).id)).toEqual(['e1', 'e2', 'e3', 'e4', 'e5', 'e6', 'e7', 'e8'])
    expect(request).toHaveBeenCalledTimes(8)
    expect(new URL(request.mock.calls[7]![0]).searchParams.get('pageToken')).toBe('p8')
  })

  it('fails as tooMany, with no items, when the eighth page still has a continuation', async () => {
    const request = pages(9)
    const result = await run(request as unknown as typeof fetch)
    expect(result).toEqual({ ok: false, failure: { code: 'tooMany' } })
    expect(request).toHaveBeenCalledTimes(8)
  })

  it('maps 401 to expired', async () => {
    expect(await run((async () => json({ error: { code: 401 } }, 401)) as typeof fetch)).toEqual({ ok: false, failure: { code: 'expired' }, status: 401 })
  })

  it('maps 429 to busy after exactly one request, with no retry', async () => {
    const request = vi.fn(async () => json({ error: { code: 429 } }, 429))
    expect(await run(request as unknown as typeof fetch)).toEqual({ ok: false, failure: { code: 'busy' }, status: 429 })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it.each(['rateLimitExceeded', 'userRateLimitExceeded'])('maps a 403 %s to busy after exactly one request', async (reason) => {
    const request = vi.fn(async () => json({ error: { code: 403, errors: [{ reason, message: 'Rate Limit Exceeded' }] } }, 403))
    expect(await run(request as unknown as typeof fetch)).toEqual({ ok: false, failure: { code: 'busy' }, status: 403 })
    expect(request).toHaveBeenCalledTimes(1)
  })

  it('maps any other 403 to denied with the reason code only, never Google’s text', async () => {
    const body = { error: { code: 403, message: 'Calendar of ana@example.com: API not enabled in project 123', errors: [{ reason: 'accessNotConfigured', message: 'ana@example.com' }] } }
    const result = await run((async () => json(body, 403)) as typeof fetch)
    expect(result).toEqual({ ok: false, failure: { code: 'denied', reason: 'accessNotConfigured' }, status: 403 })
    expect(JSON.stringify(result)).not.toContain('example.com')
    const unreadable = await run((async () => json({ error: { errors: [{ reason: 'has spaces and ana@example.com' }] } }, 403)) as typeof fetch)
    expect(unreadable).toEqual({ ok: false, failure: { code: 'denied', reason: 'unknown' }, status: 403 })
  })

  it('maps a network failure to network', async () => {
    expect(await run((async () => { throw new TypeError('Failed to fetch') }) as typeof fetch)).toEqual({ ok: false, failure: { code: 'network' } })
  })

  it('aborts a request after the 15 s deadline and reports timeout', async () => {
    vi.useFakeTimers()
    expect(REQUEST_DEADLINE_MS).toBe(15_000)
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const outcome = run(request as unknown as typeof fetch)
    await vi.advanceTimersByTimeAsync(REQUEST_DEADLINE_MS - 1)
    expect(request.mock.calls[0]![1].signal!.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await outcome).toEqual({ ok: false, failure: { code: 'timeout' } })
  })

  it('reports an abort by the caller as aborted, not as a failure to show', async () => {
    const controller = new AbortController()
    const request = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    }))
    const outcome = run(request as unknown as typeof fetch, controller.signal)
    controller.abort()
    expect(await outcome).toEqual({ ok: false, failure: { code: 'aborted' } })
  })

  it('treats a body that is not an events page as malformed', async () => {
    expect(await run((async () => json({ items: 'nope' })) as typeof fetch)).toEqual({ ok: false, failure: { code: 'malformed' }, status: 200 })
  })
})
