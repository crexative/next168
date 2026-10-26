// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { calendarExport, googleCalendarUrl, outlookCalendarUrl } from '../calendarExport'
import { buildExportBundle, bundleHash, parseExportBundle } from '../exportBundle'
import { assistantContext, proposalJsonSchema } from '../assistantContext'
import { canonicalJson } from '../canonical'
import { clock, document, env, sampleV1, block } from './fixtures'
import type { PlannerEvent } from '../model'
const event: PlannerEvent = { id: 'event/1', title: 'Meet, test;\\line\nNew', start: '2026-10-24T10:00:00-05:00', end: '2026-10-24T11:00:00-05:00', allDay: false, location: 'Room, 1', notes: 'é🙂'.repeat(80) + '\r\nlast', attendees: ['one@example.test', 'two@example.test'] }

// Independent, minimal RFC 5545 content-line reader for the subset exported by this slice.
function readIcs(text: string) {
  const lines = text.replace(/\r\n[ \t]/g, '').split('\r\n')
  const fields = new Map<string, string[]>()
  for (const line of lines) {
    const colon = line.indexOf(':'); if (colon < 0) continue
    const key = line.slice(0, colon).split(';')[0]!
    const value = line.slice(colon + 1).replace(/\\([nN,;\\])/g, (_, char: string) => /[nN]/.test(char) ? '\n' : char)
    fields.set(key, [...(fields.get(key) ?? []), value])
  }
  return fields
}
describe('calendar portability', () => {
  it('exports UTC times, attendees, stable UID, escaped text and UTF-8 folds at <=75 octets', () => {
    const ics = calendarExport([event], clock)
    const fields = readIcs(ics)
    expect(fields.get('METHOD')).toEqual(['PUBLISH'])
    expect(fields.get('DTSTART')).toEqual(['20261024T150000Z'])
    expect(fields.get('DTEND')).toEqual(['20261024T160000Z'])
    expect(fields.get('DTSTAMP')).toEqual(['20261024T120000Z'])
    expect(fields.get('SUMMARY')).toEqual([event.title])
    expect(fields.get('DESCRIPTION')).toEqual([event.notes!.replace(/\r\n/g, '\n')])
    expect(fields.get('ATTENDEE')).toEqual(['mailto:one@example.test', 'mailto:two@example.test'])
    expect(fields.get('UID')).toEqual(readIcs(calendarExport([{ ...event, title: 'Changed' }], clock)).get('UID'))
    expect(ics.endsWith('\r\n')).toBe(true)
    for (const line of ics.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(ics).not.toContain('�')
  })
  it('exports all-day exclusive dates and optional text correctly', () => {
    const allDay = { ...event, allDay: true, start: '2026-10-24T00:00:00Z', end: '2026-10-26T00:00:00Z', notes: undefined, location: undefined, attendees: [] }
    const text = calendarExport([allDay], clock)
    expect(text).toContain('DTSTART;VALUE=DATE:20261024\r\nDTEND;VALUE=DATE:20261026')
    expect(text).not.toContain('DESCRIPTION:')
    expect(() => calendarExport([{ ...event, title: '\r\nBEGIN:EVIL', attendees: ['bad\r\nBEGIN:EVIL'] }], clock)).toThrow()
  })
  it('escapes CRLF and delimiters in every text property so no content line can be injected', () => {
    const hostile = 'Plan\r\nATTENDEE:mailto:evil@example.test\r\nEND:VEVENT;x,y'
    const ics = calendarExport([{ ...event, title: hostile, location: hostile, notes: hostile, attendees: [] }], clock)
    const unfolded = ics.replace(/\r\n[ \t]/g, '').split('\r\n')
    expect(unfolded.filter((line) => line.startsWith('ATTENDEE'))).toEqual([])
    expect(unfolded.filter((line) => line === 'END:VEVENT')).toHaveLength(1)
    const fields = readIcs(ics)
    for (const key of ['SUMMARY', 'LOCATION', 'DESCRIPTION']) expect(fields.get(key)).toEqual([hostile.replace(/\r\n/g, '\n')])
  })

  it('folds exactly at the 75-octet boundary', () => {
    const fits = 'x'.repeat(75 - 'SUMMARY:'.length)
    const exact = calendarExport([{ ...event, title: fits, notes: undefined, location: undefined, attendees: [] }], clock)
    expect(exact.split('\r\n')).toContain(`SUMMARY:${fits}`)
    const over = calendarExport([{ ...event, title: fits + 'y', notes: undefined, location: undefined, attendees: [] }], clock)
    expect(over.split('\r\n')).toContain(`SUMMARY:${fits}`)
    expect(over.split('\r\n')).toContain(' y')
  })

  it('encodes calendar links with title, times, details, location and attendees', () => {
    const google = new URL(googleCalendarUrl(event))
    expect(google.origin).toBe('https://calendar.google.com')
    expect(google.pathname).toBe('/calendar/r/eventedit')
    expect(Object.fromEntries(google.searchParams)).toMatchObject({ action: 'TEMPLATE', text: event.title, dates: '20261024T150000Z/20261024T160000Z', details: event.notes, location: event.location, add: event.attendees.join(',') })
    const outlook = new URL(outlookCalendarUrl(event))
    expect(outlook.hostname).toBe('outlook.live.com')
    expect(Object.fromEntries(outlook.searchParams)).toMatchObject({ subject: event.title, startdt: '2026-10-24T15:00:00.000Z', enddt: '2026-10-24T16:00:00.000Z', body: event.notes, to: event.attendees.join(';'), allday: 'false' })
    expect(new URL(googleCalendarUrl({ ...event, allDay: true, end: '2026-10-25T00:00:00Z' })).searchParams.get('dates')).toBe('20261024/20261025')
    expect(new URL(outlookCalendarUrl({ ...event, allDay: true, end: '2026-10-25T00:00:00Z', notes: undefined, location: undefined })).searchParams.get('allday')).toBe('true')
  })
})
describe('export bundles', () => {
  it('round-trips document and raw calendar text with a stable read-back hash', async () => {
    const doc = document(); doc.calendarSources = [{ id: 'source', name: 'Calendar', kind: 'file', colorKey: 'blue' }]
    const sourceTexts = { source: 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n' }
    const bundle = buildExportBundle(doc, sourceTexts, clock)
    const result = parseExportBundle(JSON.stringify(bundle))
    expect(result).toMatchObject({ kind: 'ok', bundle })
    if (result.kind !== 'ok') throw Error('parse')
    expect(await bundleHash(result.bundle)).toBe(await bundleHash(bundle))
    expect(await bundleHash({ ...bundle, calendarSourceTexts: { source: 'changed' } })).not.toBe(await bundleHash(bundle))
    doc.settings.locale = 'fr'; sourceTexts.source = 'changed'
    expect(bundle.document.settings.locale).toBe('en')
    expect(bundle.calendarSourceTexts.source).not.toBe('changed')
  })
  it('accepts bare legacy WeekData through explicit migration environment', () => {
    expect(parseExportBundle(JSON.stringify(sampleV1), env)).toMatchObject({ kind: 'ok', migratedFrom: 1, bundle: { document: { categories: expect.arrayContaining([expect.objectContaining({ id: 'sleep' })]) } } })
    expect(parseExportBundle(JSON.stringify(sampleV1))).toMatchObject({ kind: 'corrupt' })
  })
  it('rejects corrupt, future, missing source text and semantic corruption', () => {
    expect(parseExportBundle('{')).toMatchObject({ kind: 'corrupt' })
    expect(parseExportBundle('{"schemaVersion":99}', env)).toMatchObject({ kind: 'unsupported' })
    const doc = document(); doc.calendarSources = [{ id: 'source', name: 'Calendar', kind: 'file', colorKey: 'blue' }]
    expect(() => buildExportBundle(doc, {}, clock)).toThrow('missingSource')
    expect(() => buildExportBundle(document(), { foreign: 'text' }, clock)).toThrow('unknownSource')
    const bundle = buildExportBundle(document(), {}, clock)
    bundle.document.categories.push({ ...bundle.document.categories[0]! })
    expect(parseExportBundle(JSON.stringify(bundle))).toMatchObject({ kind: 'corrupt' })
    expect(parseExportBundle(JSON.stringify({ ...bundle, bundleVersion: 99 }))).toMatchObject({ kind: 'unsupported' })
  })
})
describe('assistant context', () => {
  it('exports compact computed facts and never the notes, only that one exists', () => {
    const doc = document(); doc.blocks = [{ ...block, notes: 'Private note' }]
    const context = JSON.parse(assistantContext(doc))
    expect(context).toMatchObject({ workspaceId: 'workspace', revision: 0, categories: [{ id: 'work' }], blocks: [{ id: 'block', hasNotes: true }], stats: { plannedMinutes: 480 } })
    expect(assistantContext(doc)).not.toContain('Private note')
    expect(proposalJsonSchema()).toMatchObject({ type: 'object', required: expect.arrayContaining(['workspaceId', 'baseRevision', 'ops']) })
    expect(assistantContext(doc)).not.toContain('\n')
  })
  it('canonicalizes nested arrays and drops undefined optional properties', () => {
    expect(canonicalJson({ z: [{ b: 2, a: 1 }], a: undefined })).toBe('{"z":[{"a":1,"b":2}]}')
    expect(() => canonicalJson(undefined)).toThrow('invalidJson')
  })
})
