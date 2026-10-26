import { describe, expect, it } from 'vitest'
import { createEmptyDocument } from '@/core/documents'
import type { LoadResult, PlannerDocument } from '@/core/model'
import { buildExportFile, exportFileName, freshDocument, matchesConfirmation, previewImport, replaceContent, verifyStored } from './dataTransfer'

const NOW = new Date('2026-10-24T09:30:00Z')

function sample(): PlannerDocument {
  return {
    ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'ws-1' }),
    revision: 7,
    categories: [{ id: 'c', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } }],
    blocks: [{ id: 'b', categoryId: 'c', title: 'Deep work', days: [1, 2], start: 540, end: 780 }],
    tasks: [{ id: 't', title: 'Report', categoryId: 'c', durationMin: 60, priority: 2, createdAt: '2026-10-23T10:00:00Z' }],
    checkIns: [{ date: '2026-10-23', bedtime: 1380, wake: 420 }],
  }
}

describe('export and import', () => {
  it('names the file with the export date and round-trips through the preview', async () => {
    const document = sample()
    const { fileName, json } = await buildExportFile(document, undefined, { now: () => NOW })
    expect(fileName).toBe('weeklid-export-2026-10-24.json')
    expect(exportFileName(new Date('2026-01-02T23:59:59Z'))).toBe('weeklid-export-2026-01-02.json')
    const result = previewImport(json, createEmptyDocument({ now: NOW, locale: 'de', timeZone: 'UTC' }), NOW)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.preview.document).toEqual(document)
    expect(result.preview.counts).toMatchObject({ categories: 1, blocks: 1, tasks: 1, checkIns: 1 })
    expect(result.preview.migratedFrom).toBeUndefined()
    expect(result.preview.sourceVersion).toBe(3)
  })

  it('migrates a v1 file and reports it', () => {
    const v1 = JSON.stringify({
      categories: [{ id: 'c1', name: 'Work', color: '#3b82f6', weeklyHourLimit: 40 }],
      timeBlocks: [{ id: 'b1', categoryId: 'c1', title: 'Focus', dayOfWeek: 1, startTime: '09:00', endTime: '11:00', durationMinutes: 120, repeatDays: [1, 2] }],
    })
    const result = previewImport(v1, sample(), NOW)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.preview.migratedFrom).toBe(1)
    expect(result.preview.sourceVersion).toBe(1)
    expect(result.preview.document.blocks[0]).toMatchObject({ days: [1, 2], start: 540, end: 660 })
    expect(result.preview.document.categories[0]!.goal).toEqual({ type: 'max', hoursPerWeek: 40 })
  })

  it('rejects garbage and newer versions without throwing', () => {
    expect(previewImport('not json', sample(), NOW).kind).toBe('invalid')
    expect(previewImport(JSON.stringify({ schemaVersion: 9 }), sample(), NOW)).toEqual({ kind: 'unsupported', version: 9 })
  })

  it('verifies a stored document ignoring revision bookkeeping and detects differences', async () => {
    const document = sample()
    const preview = previewImport((await buildExportFile(document, undefined, { now: () => NOW })).json, document, NOW)
    if (preview.kind !== 'ok') throw new Error('preview failed')
    const stored: PlannerDocument = { ...document, revision: 12, updatedAt: '2026-10-24T10:00:00.000Z' }
    const readBack = (value: PlannerDocument) => async (): Promise<LoadResult> => ({ kind: 'ok', document: value })
    expect((await verifyStored(preview.preview.bundle, readBack(stored), undefined)).ok).toBe(true)
    const tampered = { ...stored, tasks: [] }
    expect(await verifyStored(preview.preview.bundle, readBack(tampered), undefined)).toEqual({ ok: false, reason: 'mismatch' })
    expect(await verifyStored(preview.preview.bundle, async () => ({ kind: 'empty' }), undefined)).toEqual({ ok: false, reason: 'unreadable' })
  })

  it('replaces draft content wholesale and creates a fresh document that keeps preferences', () => {
    const draft = createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'other' })
    replaceContent(draft, sample())
    expect(draft.workspaceId).toBe('ws-1')
    expect(draft.categories).toHaveLength(1)
    const current = { ...sample(), settings: { ...sample().settings, theme: 'dark' as const, onboardingDone: true } }
    const fresh = freshDocument(current, NOW)
    expect(fresh.categories).toEqual([])
    expect(fresh.settings).toMatchObject({ theme: 'dark', onboardingDone: true })
    expect(fresh.workspaceId).not.toBe('ws-1')
  })

  it('compares the typed confirmation case-insensitively', () => {
    expect(matchesConfirmation(' delete ', 'DELETE')).toBe(true)
    expect(matchesConfirmation('delet', 'DELETE')).toBe(false)
  })
})
