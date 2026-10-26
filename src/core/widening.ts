import { validateDocumentV2 } from './legacy/v2'
import { SCHEMA_VERSION } from './model'

// Schema v2 -> v3, pure and lossless: every v3 task field is optional, and the two new collections start empty. A v2
// document is first checked against the frozen v2 schema, so a widened document is exactly a valid v2 one.
const migrations: Record<number, (raw: unknown) => unknown> = {
  2: (raw) => ({ ...structuredClone(validateDocumentV2(raw)), schemaVersion: 3, generation: 0, appliedCaptureIds: [] }),
}

// Any stored document of a known older version, widened step by step to the current version; others pass through.
export function widenToCurrent(raw: unknown): unknown {
  let value = raw
  for (;;) {
    const version = typeof value === 'object' && value !== null && 'schemaVersion' in value ? value.schemaVersion : undefined
    const step = typeof version === 'number' && version < SCHEMA_VERSION ? migrations[version] : undefined
    if (!step) return value
    value = step(value)
  }
}
