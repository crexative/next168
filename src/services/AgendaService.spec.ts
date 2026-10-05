import { describe, it, expect } from 'vitest'
import { emptyAgenda, isDate, moveProposal, previewMoves, proposalRequest, validateAgenda, workWarnings } from './AgendaService'
import { calendarPreview, createCalendarFile, eventFingerprint } from './CalendarExportService'
import { item } from '@/fixtures/agenda'
describe('dated planning and safe proposals', () => {
  it('validates actual dates and forbids overnight agenda blocks', () => {
    expect(isDate('2026-02-30')).toBe(false)
    expect(isDate('2028-02-29')).toBe(true)
    expect(() => validateAgenda({ ...emptyAgenda(), items: [item({ startTime: '23:00', endTime: '01:00' })] })).toThrow()
    expect(() => validateAgenda({ ...emptyAgenda(), schemaVersion: 2 })).toThrow()
    expect(() => validateAgenda({ ...emptyAgenda(), items: [item(), item()] })).toThrow('Duplicate')
  })
  it('rejects coerced enum arrays at the import boundary', () => {
    for (const field of ['kind', 'status']) {
      const value = field === 'kind' ? ['task'] : ['done']
      expect(() => validateAgenda({ ...emptyAgenda(), items: [{ ...item(), [field]: value }] })).toThrow()
    }
    expect(() => validateAgenda({ ...emptyAgenda(), workEnd: ['17:00'] })).toThrow()
    expect(() => validateAgenda({ ...emptyAgenda(), items: [{ ...item(), kind: ['task'], calendarSelected: true }] })).toThrow()
  })
  it('moves a pending task once with the same ID; does not modify the source', () => {
    const source = { ...emptyAgenda(), items: [item()] }
    const moved = previewMoves(source, moveProposal(source, { id: 'task-1', date: '2026-10-06', startTime: '18:00', endTime: '19:00' }))
    expect(moved.items).toHaveLength(1); expect(moved.items[0]?.id).toBe('task-1')
    expect(source.items[0]?.date).toBe('2026-10-05')
  })
  it('rejects stale, extra fields, duplicates, protected commitments and partial conflicting batches', () => {
    const source = { ...emptyAgenda(), items: [item(), item({ id: 'reserved', kind: 'reservation', status: 'reserved', startTime: '20:00', endTime: '21:00' })] }
    const move = { id: 'task-1', date: '2026-10-05', startTime: '20:30', endTime: '21:30' }
    expect(() => previewMoves(source, moveProposal(source, move))).toThrow('conflict')
    expect(() => previewMoves(source, { ...moveProposal(source, move), baseRevision: 'stale' })).toThrow('stale')
    expect(() => previewMoves(source, { ...moveProposal(source, move), tool: 'calendar.write' })).toThrow('fields')
    expect(() => previewMoves(source, moveProposal(source, { ...move, id: 'reserved' }))).toThrow('pending')
    const safeMove = { ...move, date: '2026-10-06' }
    expect(() => previewMoves(source, { ...moveProposal(source, safeMove), moves: [safeMove, safeMove] })).toThrow('unique')
    for (const status of ['done', 'cancelled'] as const) expect(() => previewMoves({ ...source, items: [item({ status })] }, moveProposal(source, safeMove))).toThrow('pending')
    expect(source.items[0]?.startTime).toBe('18:00')
  })
  it('checks the entire resulting batch, permitting adjacent intervals', () => {
    const source = { ...emptyAgenda(), items: [item(), item({ id: 'task-2', startTime: '19:00', endTime: '20:00' })] }
    const moves = [{ id: 'task-1', date: '2026-10-06', startTime: '18:00', endTime: '19:00' }, { id: 'task-2', date: '2026-10-06', startTime: '18:30', endTime: '19:30' }]
    expect(() => previewMoves(source, { schemaVersion: 1, baseRevision: source.revision, moves })).toThrow('conflict')
    expect(validateAgenda(source).items).toHaveLength(2)
  })
  it('keeps a deferred purchase list, budget and identity', () => {
    const purchase = item({ title: 'Synthetic grocery purchase', checklist: ['Rice', 'Coffee'], budgetCop: 120000, notes: 'Synthetic planned purchase; no payment verification' })
    const source = { ...emptyAgenda(), items: [purchase] }
    const result = previewMoves(source, moveProposal(source, { id: purchase.id, date: '2026-10-07', startTime: '18:00', endTime: '19:00' }))
    expect(result.items[0]).toMatchObject({ id: purchase.id, checklist: purchase.checklist, budgetCop: 120000, notes: purchase.notes })
    expect(result.items).toHaveLength(1)
  })
  it('recalculates conflicts when manually moving a confirmed class without converting it to a proposal', () => {
    const reservation = item({ id: 'class', title: 'Synthetic confirmed class', kind: 'reservation', status: 'reserved', flexible: false })
    const dinner = item({ id: 'dinner', title: 'Synthetic dinner', startTime: '19:00', endTime: '20:00' })
    expect(() => validateAgenda({ ...emptyAgenda(), items: [{ ...reservation, startTime: '19:30', endTime: '20:30' }, dinner] })).toThrow('conflict')
    const result = validateAgenda({ ...emptyAgenda(), items: [{ ...reservation, startTime: '20:00', endTime: '21:00' }, dinner] })
    expect(result.items[0]?.status).toBe('reserved')
  })
  it('reports external availability as unknown and work as flexible', () => {
    const source = { ...emptyAgenda(), items: [item({ startTime: '08:30', endTime: '09:00' })] }
    expect(proposalRequest(source).calendarAccess).toBe('unavailable')
    expect(workWarnings(source)).toHaveLength(1)
    expect(proposalRequest({ ...source, workEnd: '17:30' }).workWindow.end).toBe('17:30')
  })
})
describe('selective Calendar files', () => {
  it('exports only chosen commitments with Bogotá timestamps and stable UID', () => {
    const meeting = item({ id: 'meeting-1', kind: 'meeting', calendarSelected: true, startTime: '08:30', endTime: '09:30', title: 'Synthetic, meeting; test\nline' })
    const source = { ...emptyAgenda(), items: [item(), meeting] }
    const file = createCalendarFile(source, new Date('2026-10-05T00:00:00Z'))
    expect(file).toContain('DTSTART:20261005T133000Z\r\n')
    expect(file).toContain('UID:meeting-1@next168.local')
    expect(file).not.toContain('UID:task-1')
    expect(file).toContain('SUMMARY:Synthetic\\, meeting\\; test\\nline')
    expect(createCalendarFile({ ...source, items: [{ ...meeting, date: '2026-10-06' }] })).toContain('UID:meeting-1@next168.local')
  })
  it('skips identical locally prepared events; changes remain reviewable', () => {
    const meeting = item({ kind: 'meeting', calendarSelected: true })
    const source = { ...emptyAgenda(), items: [meeting], exports: { [meeting.id]: eventFingerprint(meeting) } }
    expect(calendarPreview(source)).toHaveLength(0)
    expect(calendarPreview({ ...source, items: [{ ...meeting, title: 'Changed' }] })).toHaveLength(1)
    expect(calendarPreview({ ...source, items: [{ ...meeting, status: 'cancelled' }] })).toHaveLength(0)
  })
  it('folds unicode lines to at most 75 bytes and does not create invitations or alarms', () => {
    const source = { ...emptyAgenda(), items: [item({ kind: 'reminder', calendarSelected: true, title: '☕'.repeat(60) })] }
    const file = createCalendarFile(source)
    expect(file.split('\r\n').every(line => new TextEncoder().encode(line).length <= 75)).toBe(true)
    expect(file).not.toMatch(/ATTENDEE|VALARM/)
  })
})
