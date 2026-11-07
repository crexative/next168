// What the server accepts, stores and returns for a plan (S0): a bounded body, a document that parses as a planner
// document, gzip, then AES-GCM sealing into one BLOB that always fits a D1 row.
import { plannerDocumentSchema } from '../../src/core/model'
import { keyId, openBytes, sealBytes, type RandomSource } from '../google/crypto'

/** A request body above this is refused with 413 before it is read in full. */
export const MAX_BODY_BYTES = 2_000_000
/** The sealed row stays under D1's 2 MB row limit with headroom; also a CHECK in the migration. */
export const MAX_STORED_BYTES = 1_900_000
export const PAYLOAD_FORMAT = 1

export type BodyResult = { kind: 'ok'; text: string } | { kind: 'tooLarge' } | { kind: 'unreadable' }

// Refuses on the declared length without touching the body, and otherwise stops reading at the limit.
export async function readBoundedBody(request: Request, limit: number = MAX_BODY_BYTES): Promise<BodyResult> {
  const encoding = request.headers.get('content-encoding')
  if (encoding !== null && encoding.trim().toLowerCase() !== 'identity') return { kind: 'unreadable' }
  const declared = request.headers.get('content-length')
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > limit) return { kind: 'tooLarge' }
  if (!request.body) return { kind: 'ok', text: '' }
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return { kind: 'tooLarge' }
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return { kind: 'ok', text: new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(bytes) }
  } catch {
    return { kind: 'unreadable' }
  }
}

export type PlannerDocument = ReturnType<typeof plannerDocumentSchema.parse>

/** The parsed document, or null for anything that is not a valid planner document. Unknown keys are dropped. */
export function parsePlan(value: unknown): PlannerDocument | null {
  const parsed = plannerDocumentSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

async function pipe(bytes: Uint8Array<ArrayBuffer>, transform: CompressionStream | DecompressionStream): Promise<Uint8Array<ArrayBuffer>> {
  return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(transform)).arrayBuffer())
}

const planAad = (accountId: string): string => `weeklid/sync/plan/v${PAYLOAD_FORMAT}/${accountId}`

export interface SealedPlan {
  format: number
  keyId: string
  payload: Uint8Array<ArrayBuffer>
}

const planBytes = (document: PlannerDocument): Uint8Array<ArrayBuffer> => new Uint8Array(new TextEncoder().encode(JSON.stringify(document)))

async function sealed(document: PlannerDocument, key: Uint8Array<ArrayBuffer>, accountId: string, random: RandomSource): Promise<Uint8Array<ArrayBuffer>> {
  return sealBytes(key, planAad(accountId), await pipe(planBytes(document), new CompressionStream('gzip')), random)
}

/** The serialized and the sealed size of a document, for the S0 measurement. */
export async function measurePlan(document: PlannerDocument, key: Uint8Array<ArrayBuffer>, random: RandomSource): Promise<{ jsonBytes: number; sealedBytes: number }> {
  return { jsonBytes: planBytes(document).length, sealedBytes: (await sealed(document, key, 'measure', random)).length }
}

/** Null when the sealed row would not fit: "plan too large to sync". */
export async function sealPlan(
  document: PlannerDocument, key: Uint8Array<ArrayBuffer>, accountId: string, random: RandomSource, maxBytes: number = MAX_STORED_BYTES,
): Promise<SealedPlan | null> {
  const payload = await sealed(document, key, accountId, random)
  return payload.length > maxBytes ? null : { format: PAYLOAD_FORMAT, keyId: await keyId(key), payload }
}

/** Null when the row was sealed under another key or format, or does not authenticate. */
export async function openPlan(stored: { format: number; keyId: string; payload: Uint8Array<ArrayBuffer> }, key: Uint8Array<ArrayBuffer>, accountId: string): Promise<PlannerDocument | null> {
  if (stored.format !== PAYLOAD_FORMAT || stored.keyId !== await keyId(key)) return null
  try {
    const compressed = await openBytes(key, planAad(accountId), stored.payload)
    return JSON.parse(new TextDecoder().decode(await pipe(compressed, new DecompressionStream('gzip')))) as PlannerDocument
  } catch {
    return null
  }
}
