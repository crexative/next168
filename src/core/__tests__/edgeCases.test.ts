// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { calendarExport, googleCalendarUrl } from '../calendarExport'
import { migrateToCurrent } from '../migrations'
import { parseDocument } from '../documents'
import { buildExportBundle, bundleHash, parseExportBundle } from '../exportBundle'
import { datedOccurrences, occurrences, zonedInstant } from '../time'
import { sevenDayMeasures } from '../stats'
import { scheduleTasks } from '../scheduler'
import { commitProposal, buildProposal, canonicalContentHash, previewProposal } from '../proposals'
import { clock, document, env, block, sampleV1 } from './fixtures'
import type { ProposalInput } from '../model'

describe('boundary regressions', () => {
  it('hashes portable content independently of export time for read-back verification', async () => {
    const first = buildExportBundle(document(), {}, clock)
    const later = buildExportBundle(document(), {}, { now: () => new Date('2026-10-25T12:00:00Z') })
    expect(first.exportedAt).not.toBe(later.exportedAt)
    expect(await bundleHash(first)).toBe(await bundleHash(later))
  })
  it('orders creation instants chronologically even when offsets differ', () => {
    const doc = document(); doc.blocks = [{ ...block, start: 420, end: 480 }]
    const task = { title: 'Task', categoryId: 'work', durationMin: 60, priority: 1 as const }
    doc.tasks = [
      { ...task, id: 'later', createdAt: '2026-09-30T23:45:00Z' },
      { ...task, id: 'earlier', createdAt: '2026-10-01T00:30:00+01:00' },
    ]
    expect(scheduleTasks({ document: doc, busy: [], now: clock.now(), timeZone: 'America/Bogota' })[0]?.taskId).toBe('earlier')
  })

  it('treats non-JSON runtime values as corruption without throwing', () => {
    const cyclic: Record<string, unknown> = {}; cyclic.self = cyclic
    for (const raw of [cyclic, 1n, undefined, NaN, () => 1]) {
      expect(migrateToCurrent(raw, env)).toMatchObject({ kind: 'corrupt' })
    }
  })
  it('rejects explicit unsupported old versions rather than treating them as legacy', () => {
    expect(migrateToCurrent({ ...sampleV1, schemaVersion: 0 }, env)).toMatchObject({ kind: 'corrupt' })
  })
  it('retains new-workspace randomness and tutorial flag in the empty factory', () => {
    const result = migrateToCurrent({ categories: [], timeBlocks: [] }, { ...env, idGen: undefined })
    expect(result).toMatchObject({ kind: 'ok', migratedFrom: 1 })
  })
  it('rejects dangling task categories and duplicate replay ids', () => {
    const doc = document(); doc.tasks.push({ id: 't', title: 'T', categoryId: 'missing', durationMin: 15, priority: 1, createdAt: clock.now().toISOString() })
    expect(parseDocument(JSON.stringify(doc))).toMatchObject({ kind: 'corrupt' })
    doc.tasks = []; doc.appliedProposalIds = ['p', 'p']
    expect(parseDocument(JSON.stringify(doc))).toMatchObject({ kind: 'corrupt' })
  })
  it('does not create a zero-length midnight segment', () => {
    expect(occurrences({ ...block, end: 0 })).toEqual([{ start: 9960, end: 10080, day: 6 }])
    expect(() => datedOccurrences(document(), '2026-01-01', 0, 'UTC')).toThrow('invalidRange')
    expect(() => datedOccurrences(document(), '2026-01-01', 367, 'UTC')).toThrow('invalidRange')
  })
  it('handles skipped civil dates and half-hour gaps compatibly', () => {
    expect(zonedInstant('2011-12-30', 720, 'Pacific/Apia').toISOString()).toBe('2011-12-30T22:00:00.000Z')
    expect(zonedInstant('2026-10-04', 135, 'Australia/Lord_Howe').toISOString()).toBe('2026-10-03T15:45:00.000Z')
  })
  it('omits a dated interval that collapses in a spring gap', () => {
    const doc = document(); doc.blocks = [{ ...block, days: [0], start: 150, end: 180 }]
    expect(datedOccurrences(doc, '2026-03-29', 1, 'Europe/Berlin')).toEqual([])
  })
  it('computes sleep elapsed minutes for the waking date across DST', () => {
    const entry = { date: '2026-03-29', bedtime: 1380, wake: 420 }
    expect(sevenDayMeasures([entry], entry.date, 3, 'Europe/Berlin').averageSleepMinutes).toBe(420)
    expect(sevenDayMeasures([{ ...entry, date: '2026-10-25' }], '2026-10-25', 3, 'Europe/Berlin').averageSleepMinutes).toBe(540)
  })
  it('rejects invalid busy instants and rounds seconds forward', () => {
    const doc = document(); doc.blocks = [{ ...block, start: 420, end: 480 }]
    doc.tasks = [{ id: 't', title: 'T', categoryId: 'work', durationMin: 60, priority: 1, createdAt: clock.now().toISOString() }]
    expect(() => scheduleTasks({ document: doc, busy: [{ start: 'bad', end: 'bad' }], now: clock.now(), timeZone: 'UTC' })).toThrow('invalidBusy')
    expect(scheduleTasks({ document: doc, busy: [], now: new Date('2026-10-24T12:00:30Z'), timeZone: 'America/Bogota', days: 1 })[0]).toMatchObject({ overflowMinutes: 1, chunks: [{ start: '2026-10-24T12:01:00.000Z', end: '2026-10-24T13:00:00.000Z' }] })
  })
  it('rejects invalid all-day ranges rather than exporting a zero-day event', () => {
    const event = { id: 'day', title: 'Day', start: '2026-10-24T10:00:00Z', end: '2026-10-24T11:00:00Z', allDay: true, attendees: [] }
    expect(() => calendarExport([event], clock)).toThrow('invalidAllDayRange')
    expect(() => googleCalendarUrl(event)).toThrow('invalidAllDayRange')
  })
  it('rejects byte-oversized raw calendar text and future wrapped documents', () => {
    const doc = document(); doc.calendarSources = [{ id: 'calendar', name: 'Calendar', colorKey: 'blue', kind: 'file' }]
    expect(() => buildExportBundle(doc, { calendar: 'é'.repeat(3 * 1024 * 1024) }, clock)).toThrow('sourceTooLarge')
    const bundle = buildExportBundle(document(), {}, clock)
    expect(parseExportBundle(JSON.stringify({ ...bundle, document: { ...bundle.document, schemaVersion: 4 } }))).toEqual({ kind: 'unsupported', schemaVersion: 4 })
  })
  it('rejects partial actuals exceeding the immutable planned minutes', () => {
    const doc = document(); doc.actuals = [{ date: '2026-10-24', blockId: 'b', categoryId: 'work', plannedStartAt: '2026-10-24T00:00:00Z', plannedEndAt: '2026-10-24T01:00:00Z', plannedMinutes: 60, status: 'partial', actualMinutes: 61 }]
    expect(parseDocument(JSON.stringify(doc))).toMatchObject({ kind: 'corrupt' })
  })
  it('rejects generated id collisions atomically and captures a stable preview diff', async () => {
    const doc = document(); doc.blocks = [{ ...block, id: 'preview-1' }]
    const input: ProposalInput = { contractVersion: '1.1', workspaceId: doc.workspaceId, baseRevision: 0, summary: '', ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Focus', days: [1], start: 540, end: 600 } }] }
    const proposal = await buildProposal(input, doc, 'mcp', clock, () => 'p')
    expect(await commitProposal(doc, proposal, () => 'preview-1', clock)).toMatchObject({ kind: 'rejected' })
    expect((await previewProposal(doc, proposal)).changes[0]).toMatchObject({ after: { id: 'preview-2' } })
    expect(doc.blocks).toHaveLength(1)
  })
  it('takes snapshots before awaiting the injected asynchronous hasher', async () => {
    const doc = document()
    const input: ProposalInput = { contractVersion: '1.1', workspaceId: doc.workspaceId, baseRevision: 0, summary: '', ops: [{ op: 'update_category_goal', id: 'work', goal: { type: 'min', hoursPerWeek: 1 } }] }
    const proposal = await buildProposal(input, doc, 'mcp', clock, () => 'p')
    let release: (value: string) => void = () => {}
    const waiting = new Promise<string>((resolve) => { release = resolve })
    const result = commitProposal(doc, proposal, () => 'id', clock, () => waiting)
    doc.categories[0]!.name = 'Changed after approval began'
    proposal.ops = []
    release(await canonicalContentHash({ effectiveDate: proposal.effectiveDate, ops: input.ops }))
    const applied = await result
    if (applied.kind !== 'applied') throw Error('apply')
    expect(applied.document.categories[0]?.name).toBe('Work')
    expect(applied.document.categories[0]?.goal).toEqual({ type: 'min', hoursPerWeek: 1 })
  })
})
