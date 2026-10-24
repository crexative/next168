import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import { createIcsFetcher, normalizeCalendarUrl } from './icsFetcher'
import { calendarOverlay } from './calendarOverlay'
import { createEmptyDocument } from '@/core/documents'

describe('calendar source storage', () => {
  it('retains original ICS across adapter instances and supports transfer/list/delete', async () => {
    const indexedDB = new IDBFactory()
    const first = new IndexedDbCalendarSourceStore(indexedDB)
    await first.put('source', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR')
    const second = new IndexedDbCalendarSourceStore(indexedDB)
    expect(await second.get('source')).toBe('BEGIN:VCALENDAR\r\nEND:VCALENDAR')
    expect(await second.list()).toEqual(['source'])
    await second.delete('source')
    expect(await first.get('source')).toBeUndefined()
  })
  it('rejects unavailable storage and oversized sources', async () => {
    const unavailable = new IndexedDbCalendarSourceStore(undefined)
    await expect(unavailable.get('s')).rejects.toThrow('storage')
    await expect(new IndexedDbCalendarSourceStore(new IDBFactory()).put('s', 'é'.repeat(3 * 1024 * 1024))).rejects.toThrow('size')
  })
})

describe('calendar fetching', () => {
  it('normalizes webcal, forbids credentials and non-HTTP schemes', () => {
    expect(normalizeCalendarUrl('webcal://example.invalid/feed')).toBe('https://example.invalid/feed')
    for (const url of ['file:///tmp/calendar', 'https://user:password@example.invalid']) expect(() => normalizeCalendarUrl(url)).toThrow('url')
  })
  it('uses direct browser CORS fetch, or the paired companion endpoint with cookies', async () => {
    const calls: [string, RequestInit | undefined][] = []
    const request: typeof fetch = async (url, options) => { calls.push([String(url), options]); return new Response('BEGIN:VCALENDAR\r\nEND:VCALENDAR') }
    await createIcsFetcher(request).fetch('webcal://example.invalid/feed')
    await createIcsFetcher(request, 'companion').fetch('https://example.invalid/feed')
    expect(calls[0]?.[0]).toBe('https://example.invalid/feed')
    expect(calls[0]?.[1]?.credentials).toBe('omit')
    expect(calls[1]?.[0]).toBe('/api/ics?url=https%3A%2F%2Fexample.invalid%2Ffeed')
    expect(calls[1]?.[1]?.credentials).toBe('same-origin')
  })
  it('returns a domain error for network/CORS, HTTP failures and oversized bodies', async () => {
    await expect(createIcsFetcher(async () => { throw new TypeError('Failed to fetch') }).fetch('https://example.invalid')).rejects.toThrow('fetch')
    await expect(createIcsFetcher(async () => new Response('', { status: 403 })).fetch('https://example.invalid')).rejects.toThrow('fetch')
    await expect(createIcsFetcher(async () => new Response('x'.repeat(5 * 1024 * 1024 + 1))).fetch('https://example.invalid')).rejects.toThrow('size')
  })
})

describe('calendar overlays', () => {
  it('marks only busy intersections and converts exclusive all-day dates in the planner zone', () => {
    const doc = createEmptyDocument({ now: new Date('2026-10-19T00:00:00Z'), locale: 'en', timeZone: 'America/Bogota' })
    doc.categories = [{ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
    doc.blocks = [{ id: 'block', title: 'Focus', categoryId: 'work', days: [1], start: 540, end: 600 }]
    const external = [{ sourceId: 's', uid: 'busy', title: 'Busy', start: '2026-10-19T14:00:00Z', end: '2026-10-19T15:00:00Z', allDay: false, busy: true },
      { sourceId: 's', uid: 'free', title: 'Free', start: '2026-10-19T14:00:00Z', end: '2026-10-19T15:00:00Z', allDay: false, busy: false },
      { sourceId: 's', uid: 'date', title: 'Holiday', start: '2026-10-20', end: '2026-10-21', allDay: true, busy: true }]
    const overlay = calendarOverlay(doc, external, { start: '2026-10-19', end: '2026-10-26' })
    expect(overlay.busy).toContainEqual({ start: '2026-10-20T05:00:00.000Z', end: '2026-10-21T05:00:00.000Z' })
    expect(overlay.conflicts.map(c => c.uid)).toEqual(['busy'])
    expect(overlay.conflictingBlockIds).toEqual(['block'])
    doc.events.push({ id: 'meeting', title: 'Meeting', start: '2026-10-19T14:30:00Z', end: '2026-10-19T15:30:00Z', allDay: false, attendees: [] })
    expect(calendarOverlay(doc, [], { start: '2026-10-19', end: '2026-10-26' }).conflictingBlockIds).toEqual(['block'])
  })
})
