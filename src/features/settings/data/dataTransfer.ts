import { bundleHash, buildExportBundle, parseExportBundle } from '@/core/exportBundle'
import { createEmptyDocument } from '@/core/documents'
import type { CalendarSourceStore, Clock, ExportBundle, LoadResult, PlannerDocument } from '@/core/model'

export const MAX_IMPORT_BYTES = 25 * 1024 * 1024

export function exportFileName(now: Date): string {
  return `weeklid-export-${now.toISOString().slice(0, 10)}.json`
}

export async function sourceTextsFor(document: PlannerDocument, store: CalendarSourceStore | undefined): Promise<Record<string, string>> {
  const texts: Record<string, string> = {}
  for (const source of document.calendarSources) texts[source.id] = (await store?.get(source.id)) ?? ''
  return texts
}

export async function buildExportFile(document: PlannerDocument, store: CalendarSourceStore | undefined, clock: Clock): Promise<{ fileName: string; json: string }> {
  const bundle = buildExportBundle(document, await sourceTextsFor(document, store), clock)
  return { fileName: exportFileName(clock.now()), json: JSON.stringify(bundle, null, 2) }
}

export interface ImportPreview {
  bundle: ExportBundle
  document: PlannerDocument
  sourceVersion: number
  migratedFrom?: number
  counts: { categories: number; blocks: number; tasks: number; checkIns: number; actuals: number; events: number; calendarSources: number }
}

export type PreviewResult =
  | { kind: 'ok'; preview: ImportPreview }
  | { kind: 'unsupported'; version: unknown }
  | { kind: 'invalid'; reason: string }

export function previewImport(text: string, current: PlannerDocument, now: Date): PreviewResult {
  const parsed = parseExportBundle(text, {
    now, timeZone: current.settings.timeZone, locale: current.settings.locale, tutorialCompleted: true,
  })
  if (parsed.kind === 'unsupported') return { kind: 'unsupported', version: parsed.schemaVersion }
  if (parsed.kind === 'corrupt') return { kind: 'invalid', reason: parsed.reason }
  const { document } = parsed
  return {
    kind: 'ok',
    preview: {
      bundle: parsed.bundle,
      document,
      sourceVersion: parsed.migratedFrom ?? document.schemaVersion,
      ...(parsed.migratedFrom !== undefined ? { migratedFrom: parsed.migratedFrom } : {}),
      counts: {
        categories: document.categories.length, blocks: document.blocks.length, tasks: document.tasks.length,
        checkIns: document.checkIns.length, actuals: document.actuals.length, events: document.events.length,
        calendarSources: document.calendarSources.length,
      },
    },
  }
}

// Revision and timestamp are bookkeeping of the target store; everything else must survive byte for byte.
async function contentHash(document: PlannerDocument, texts: Record<string, string>, reference: PlannerDocument): Promise<string> {
  const normalized = { ...document, revision: reference.revision, updatedAt: reference.updatedAt }
  const bundle = buildExportBundle(normalized, texts, { now: () => new Date(0) })
  return bundleHash(bundle)
}

export type VerifyResult = { ok: true; hash: string } | { ok: false; reason: 'unreadable' | 'mismatch' }

export async function verifyStored(
  expected: ExportBundle,
  readBack: () => Promise<LoadResult>,
  store: CalendarSourceStore | undefined,
): Promise<VerifyResult> {
  const stored = await readBack()
  if (stored.kind !== 'ok') return { ok: false, reason: 'unreadable' }
  const expectedHash = await contentHash(expected.document, expected.calendarSourceTexts, stored.document)
  const storedHash = await contentHash(stored.document, await sourceTextsFor(stored.document, store), stored.document)
  return expectedHash === storedHash ? { ok: true, hash: storedHash } : { ok: false, reason: 'mismatch' }
}

export function replaceContent(draft: PlannerDocument, imported: PlannerDocument): void {
  Object.assign(draft, structuredClone(imported))
}

export async function replaceSourceTexts(store: CalendarSourceStore | undefined, texts: Record<string, string>): Promise<void> {
  if (!store) return
  const keep = new Set(Object.keys(texts))
  for (const id of await store.list()) if (!keep.has(id)) await store.delete(id)
  for (const [id, text] of Object.entries(texts)) await store.put(id, text)
}

export function freshDocument(current: PlannerDocument, now: Date): PlannerDocument {
  const fresh = createEmptyDocument({ now, locale: current.settings.locale, timeZone: current.settings.timeZone })
  // Someone deleting their data from Settings is not a first-time user, so no onboarding wizard follows.
  return { ...fresh, settings: { ...current.settings, onboardingDone: true } }
}

export function matchesConfirmation(typed: string, phrase: string): boolean {
  return typed.trim().toLocaleUpperCase() === phrase.trim().toLocaleUpperCase()
}
