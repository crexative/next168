import { exportBundleSchema, type Clock, type ExportBundle, type PlannerDocument } from './model'
import { validateDocument, type DocumentEnvironment } from './documents'
import { migrateToCurrent } from './migrations'
import { canonicalJson, sha256, type Hasher } from './canonical'

export type BundleLoadResult =
  | { kind: 'ok'; bundle: ExportBundle; document: PlannerDocument; migratedFrom?: number }
  | { kind: 'corrupt'; raw: string; reason: string }
  | { kind: 'unsupported'; schemaVersion: unknown }

function validateBundle(raw: unknown): ExportBundle {
  const bundle = exportBundleSchema.parse(raw)
  bundle.document = validateDocument(bundle.document)
  const sources = new Set(bundle.document.calendarSources.map((source) => source.id))
  for (const id of sources) {
    if (!Object.prototype.hasOwnProperty.call(bundle.calendarSourceTexts, id)) throw new Error('bundle.missingSource')
  }
  for (const [id, text] of Object.entries(bundle.calendarSourceTexts)) {
    if (!sources.has(id)) throw new Error('bundle.unknownSource')
    if (new TextEncoder().encode(text).length > 5 * 1024 * 1024) throw new Error('bundle.sourceTooLarge')
  }
  return bundle
}
export function buildExportBundle(document: PlannerDocument, sourceTexts: Record<string, string>, clock: Clock): ExportBundle {
  return validateBundle({ format: 'next168-export', bundleVersion: 1, exportedAt: clock.now().toISOString(), document, calendarSourceTexts: sourceTexts })
}
export function parseExportBundle(json: string, env?: DocumentEnvironment): BundleLoadResult {
  try {
    const raw: unknown = JSON.parse(json)
    if (raw && typeof raw === 'object' && 'format' in raw && raw.format === 'next168-export') {
      if ('bundleVersion' in raw && typeof raw.bundleVersion === 'number' && raw.bundleVersion > 1) return { kind: 'unsupported', schemaVersion: raw.bundleVersion }
      if ('document' in raw && raw.document && typeof raw.document === 'object' && 'schemaVersion' in raw.document && typeof raw.document.schemaVersion === 'number' && raw.document.schemaVersion > 2) return { kind: 'unsupported', schemaVersion: raw.document.schemaVersion }
      const bundle = validateBundle(raw)
      return { kind: 'ok', bundle, document: bundle.document }
    }
    if (!env) throw new Error('bundle.migrationEnvironmentRequired')
    const result = migrateToCurrent(raw, env)
    if (result.kind === 'unsupported') return result
    if (result.kind !== 'ok') throw new Error(result.kind === 'corrupt' ? result.reason : 'bundle.empty')
    const bundle = buildExportBundle(result.document, {}, { now: () => env.now })
    return { kind: 'ok', bundle, document: bundle.document, migratedFrom: result.migratedFrom }
  } catch (error) { return { kind: 'corrupt', raw: json, reason: error instanceof Error ? error.message : String(error) } }
}
export async function bundleHash(bundle: ExportBundle, hash: Hasher = sha256): Promise<string> {
  const { document, calendarSourceTexts } = validateBundle(bundle)
  // Export timestamps are not persisted; read-back verifies the portable content only.
  return hash(canonicalJson({ document, calendarSourceTexts }))
}
