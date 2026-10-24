import { STORAGE_KEYS, type LoadResult } from '@/core/model'
import { migrateToCurrent, parseDocument } from './core'

export const TUTORIAL_KEY = 'next168-tutorial-completed'

// Every localStorage key an older build wrote planner data to. Read once by the import, removed by delete-all.
export const LEGACY_KEYS = [STORAGE_KEYS.legacyV1, STORAGE_KEYS.document, STORAGE_KEYS.backup, STORAGE_KEYS.proposals, TUTORIAL_KEY] as const

export interface LegacyReader {
  getItem(key: string): string | null
}

export interface ImportEnvironment {
  now: Date
  locale: string
  timeZone: string
  idGen: () => string
}

export interface ImportRecords {
  document: string
  backup?: string
  proposals?: string
}

export type ImportPlan =
  | { kind: 'none' }
  | { kind: 'import'; source: 'v1' | 'v2'; result: LoadResult; records?: ImportRecords }

// Pure: reads localStorage and never writes it. v2 (tester builds) wins over v1 (the old production app).
// v2 bytes are copied as they are, so corrupt or newer data still reaches recovery or read-only mode unchanged.
// v1 is migrated, and written only when the migration succeeded.
export function planLegacyImport(storage: LegacyReader, env: ImportEnvironment): ImportPlan {
  const v2 = storage.getItem(STORAGE_KEYS.document)
  if (v2 !== null) {
    const backup = storage.getItem(STORAGE_KEYS.backup)
    const proposals = storage.getItem(STORAGE_KEYS.proposals)
    return {
      kind: 'import',
      source: 'v2',
      result: parseDocument(v2),
      records: { document: v2, ...(backup !== null ? { backup } : {}), ...(proposals !== null ? { proposals } : {}) },
    }
  }
  const v1 = storage.getItem(STORAGE_KEYS.legacyV1)
  if (v1 === null) return { kind: 'none' }
  const result = migrateToCurrent(v1, { ...env, tutorialCompleted: storage.getItem(TUTORIAL_KEY) !== null })
  return { kind: 'import', source: 'v1', result, ...(result.kind === 'ok' ? { records: { document: JSON.stringify(result.document) } } : {}) }
}
