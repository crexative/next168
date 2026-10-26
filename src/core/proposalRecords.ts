import { changeProposalSchema, type ChangeProposal } from './model'
import { legacyChangeProposalSchema, type LegacyChangeProposal } from './legacy/v2'

// The stored proposal list, read per record (tasks design rev 5 §2.4, rev 6 §2.3), never as one array, so one bad
// record cannot hide the others:
// - a record labelled contract 1.1 is checked with the strict 1.1 schema and never falls back to the legacy one;
// - a record without a contract version is contract 1.0 history (the frozen d325df4 schema): readable, never
//   executed, and a pending one is shown and persisted as stale;
// - anything else is quarantined: kept byte for byte, never executed, projected or sent to an AI, shown only as escaped
//   text, and exported only by an explicit raw recovery download.
export type StoredProposal = { kind: 'current'; proposal: ChangeProposal } | { kind: 'legacy'; proposal: LegacyChangeProposal }

export interface ProposalStore {
  records: StoredProposal[]
  quarantine: string[]
}

export const EMPTY_PROPOSAL_STORE: ProposalStore = { records: [], quarantine: [] }

function classify(value: unknown): StoredProposal | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  if ('contractVersion' in value) {
    if (value.contractVersion !== '1.1') return undefined
    const parsed = changeProposalSchema.safeParse(value)
    return parsed.success ? { kind: 'current', proposal: parsed.data } : undefined
  }
  const parsed = legacyChangeProposalSchema.safeParse(value)
  if (!parsed.success) return undefined
  // A pending 1.0 proposal can never be approved: it is stale from now on.
  const proposal = parsed.data.status === 'pending' ? { ...parsed.data, status: 'stale' as const } : parsed.data
  return { kind: 'legacy', proposal }
}

// The raw text of every top-level element of a JSON array, by a scan that tracks strings and nesting like a JSON reader.
function arrayElements(text: string): string[] | undefined {
  const start = text.indexOf('[')
  if (start === -1 || text.slice(0, start).trim() !== '') return undefined
  const elements: string[] = []
  let depth = 0, inString = false, escaped = false, from = start + 1
  for (let cursor = start; cursor < text.length; cursor++) {
    const char = text[cursor]!
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '[' || char === '{') depth++
    else if (char === ']' || char === '}') {
      depth--
      if (depth === 0) {
        const last = text.slice(from, cursor).trim()
        if (last) elements.push(last)
        return text.slice(cursor + 1).trim() === '' ? elements : undefined
      }
    } else if (char === ',' && depth === 1) {
      elements.push(text.slice(from, cursor).trim())
      from = cursor + 1
    }
  }
  return undefined
}

function fromElements(elements: { raw: string; value: unknown }[], quarantine: string[] = []): ProposalStore {
  const store: ProposalStore = { records: [], quarantine: [...quarantine] }
  for (const element of elements) {
    const record = classify(element.value)
    if (record) store.records.push(record)
    else store.quarantine.push(element.raw)
  }
  return store
}

// Reads what the proposals record holds: the current format `{ records, quarantine }`, or the array every earlier
// build wrote. Unreadable text as a whole is one quarantined record.
export function readProposalStore(raw: string | undefined): ProposalStore {
  if (raw === undefined) return { records: [], quarantine: [] }
  let value: unknown
  try {
    value = JSON.parse(raw)
  } catch {
    return { records: [], quarantine: [raw] }
  }
  if (Array.isArray(value)) {
    const texts = arrayElements(raw)
    // Element texts that do not line up with the parsed array are kept as their own JSON.
    const aligned = texts && texts.length === value.length ? texts : value.map((item) => JSON.stringify(item))
    return fromElements(value.map((item, index) => ({ raw: aligned[index]!, value: item })))
  }
  if (typeof value === 'object' && value !== null && Array.isArray((value as ProposalStore).records) && Array.isArray((value as ProposalStore).quarantine)
    && (value as ProposalStore).quarantine.every((item) => typeof item === 'string')) {
    const stored = value as { records: unknown[]; quarantine: string[] }
    return fromElements(stored.records.map((item) => ({ raw: JSON.stringify(item), value: item })), stored.quarantine)
  }
  return { records: [], quarantine: [raw] }
}

export function writeProposalStore(store: ProposalStore): string {
  return JSON.stringify({ records: store.records.map((record) => record.proposal), quarantine: store.quarantine })
}

export function currentProposals(store: ProposalStore): ChangeProposal[] {
  return store.records.flatMap((record) => (record.kind === 'current' ? [record.proposal] : []))
}

export function legacyProposals(store: ProposalStore): LegacyChangeProposal[] {
  return store.records.flatMap((record) => (record.kind === 'legacy' ? [record.proposal] : []))
}

// The store with one current proposal added or replaced (matched by id); legacy records and the quarantine stay as they are.
export function withProposal(store: ProposalStore, proposal: ChangeProposal): ProposalStore {
  const index = store.records.findIndex((record) => record.kind === 'current' && record.proposal.id === proposal.id)
  const records = [...store.records]
  if (index === -1) records.push({ kind: 'current', proposal })
  else records[index] = { kind: 'current', proposal }
  return { records, quarantine: store.quarantine }
}
