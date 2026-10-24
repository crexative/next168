import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import type { ShellRegistry } from '@/app/contracts'
import { createEmptyDocument } from '@/core/documents'
import type { LoadResult, PlannerDocument } from '@/core/model'
import registerCalendars, { configureCalendarServices } from '@/features/calendars'
import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { calendarSourceStore } from './calendarSourceHook'
import { buildExportFile, previewImport, replaceSourceTexts, sourceTextsFor, verifyStored } from './dataTransfer'

const NOW = new Date('2026-10-24T09:30:00Z')
const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261026T090000Z\r\nDTEND:20261026T100000Z\r\nSUMMARY:Ünïcode ✓\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'

function planner(): PlannerDocument {
  return {
    ...createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC', idGen: () => 'ws-1' }),
    calendarSources: [
      { id: 'file-source', name: 'Imported', kind: 'file', colorKey: 'blue', lastSyncedAt: '2026-10-24T09:00:00.000Z' },
      { id: 'url-source', name: 'Feed', kind: 'url', url: 'https://example.invalid/feed.ics', colorKey: 'purple' },
    ],
    appliedProposalIds: ['proposal-1', 'proposal-2'],
  }
}

describe('calendar sources in export, import and delete-all', () => {
  const registry: ShellRegistry = { registerView: () => undefined, registerSettingsSection: () => undefined }

  it('registering the calendars feature gives Data settings the IndexedDB source store', async () => {
    configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()) })
    registerCalendars(registry)
    const store = calendarSourceStore()!
    expect(store).toBeDefined()
    const document = planner()
    await store.put('file-source', ICS)
    await store.put('url-source', `${ICS}X-CACHED:1\r\n`)
    const original = await sourceTextsFor(document, store)

    const { json } = await buildExportFile(document, store, { now: () => NOW })
    // delete everything
    await replaceSourceTexts(store, {})
    expect(await store.list()).toEqual([])

    const result = previewImport(json, createEmptyDocument({ now: NOW, locale: 'en', timeZone: 'UTC' }), NOW)
    if (result.kind !== 'ok') throw new Error('import preview failed')
    expect(result.preview.document).toEqual(document)
    expect(result.preview.document.calendarSources).toEqual(document.calendarSources)
    expect(result.preview.document.appliedProposalIds).toEqual(document.appliedProposalIds)
    await replaceSourceTexts(store, result.preview.bundle.calendarSourceTexts)

    expect(await sourceTextsFor(document, store)).toEqual(original)
    expect((await store.list()).sort()).toEqual(['file-source', 'url-source'])
    const stored: LoadResult = { kind: 'ok', document }
    expect(await verifyStored(result.preview.bundle, async () => stored, store)).toMatchObject({ ok: true })
  })
})
