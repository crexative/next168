// The sync routes: read the account's sealed copy (conditional on the ETag), write it with compare-and-swap, replace it
// under a new epoch. The device is the source of truth; the server is a relay and a copy.
import { errorClass, failure, hasExactKeys, json, jsonFallback, serve, type Reply } from '../google/http'
import { openPlan, parsePlan, readBoundedBody, sealPlan, type PlannerDocument } from './planCodec'
import type { AccountsBase } from './config'
import type { AccountsStore, SessionRow, StoredPlan } from './accountsStore'
import { admit, currentSession, isReply, seconds, TOKEN_PATTERN, type AccountsDeps } from './session'

export const ACCOUNT_HEADER = 'x-weeklid-account'
const etagOf = (version: { epoch: number; revision: number }): string => `"${version.epoch}.${version.revision}"`

interface Authorized {
  session: SessionRow
}

// The tombstone comes first and needs no session: an offline device whose account was deleted has none left, and must still
// learn `accountDeleted`. The answer reveals only that this hash was deleted, to someone who already holds the hash.
async function authorize(request: Request, deps: AccountsDeps, store: AccountsStore, accountKey: unknown): Promise<Authorized | Reply> {
  if (typeof accountKey !== 'string' || !TOKEN_PATTERN.test(accountKey)) return failure(400, 'badRequest')
  if (await store.isDeleted(accountKey)) return failure(410, 'accountDeleted')
  const session = await currentSession(request, deps, store)
  if (!session) return failure(401, 'unauthorized')
  if (session.accountKey !== accountKey) return failure(409, 'accountMismatch')
  return { session }
}

const isAuthorized = (value: Authorized | Reply): value is Authorized => 'session' in value

async function planReply(status: number, outcome: 'ok' | 'conflict' | 'replaced', stored: StoredPlan, base: AccountsBase, accountId: string): Promise<Reply> {
  const document = await openPlan(stored, base.syncKey, accountId)
  if (!document) return failure(503, 'serverConfig')
  const reply = json(status, outcome, { code: outcome, epoch: stored.epoch, revision: stored.revision, document })
  reply.headers.push(['etag', etagOf(stored)])
  return reply
}

// --- GET /api/sync ---------------------------------------------------------------------------------------------------

export function handleGetPlan(request: Request, deps: AccountsDeps): Promise<Response> {
  return serve(deps, 'sync.get', async () => {
    const admitted = await admit(request, deps, { method: 'read', requireJson: false })
    if (isReply(admitted)) return admitted
    const { base, store } = admitted
    try {
      const authorized = await authorize(request, deps, store, request.headers.get(ACCOUNT_HEADER))
      if (!isAuthorized(authorized)) return authorized
      const stored = await store.readPlan(authorized.session.accountId)
      if (!stored) return failure(404, 'noPlan')
      const etag = etagOf(stored)
      const offered = (request.headers.get('if-none-match') ?? '').split(',').map((tag) => tag.trim())
      if (offered.includes(etag)) {
        const unchanged: Reply = { status: 304, outcome: 'unchanged', body: '', headers: [['etag', etag], ['cache-control', 'no-store']] }
        return unchanged
      }
      return await planReply(200, 'ok', stored, base, authorized.session.accountId)
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
  }, jsonFallback)
}

// Reads and checks the body up to the point of a document that has not yet been parsed in depth.
async function readEnvelope(request: Request, keys: readonly string[]): Promise<{ body: Record<string, unknown> } | Reply> {
  const read = await readBoundedBody(request)
  if (read.kind === 'tooLarge') return failure(413, 'tooLarge')
  if (read.kind === 'unreadable') return failure(400, 'badRequest')
  let parsed: unknown
  try {
    parsed = JSON.parse(read.text)
  } catch {
    return failure(400, 'badRequest')
  }
  const body = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  return body && hasExactKeys(body, keys) ? { body } : failure(400, 'badRequest')
}

const isNonNegativeInteger = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0

// --- PUT /api/sync ---------------------------------------------------------------------------------------------------

export function handlePutPlan(request: Request, deps: AccountsDeps): Promise<Response> {
  return serve(deps, 'sync.put', async () => {
    const admitted = await admit(request, deps, { method: 'write', requireJson: true })
    if (isReply(admitted)) return admitted
    const { base, store } = admitted
    const envelope = await readEnvelope(request, ['accountKey', 'baseRevision', 'epoch', 'document'])
    if ('status' in envelope) return envelope
    const { body } = envelope
    if (!isNonNegativeInteger(body.baseRevision) || !isNonNegativeInteger(body.epoch)) return failure(400, 'badRequest')
    const { baseRevision, epoch } = body
    try {
      const authorized = await authorize(request, deps, store, body.accountKey)
      if (!isAuthorized(authorized)) return authorized
      const { accountId } = authorized.session
      const document: PlannerDocument | null = parsePlan(body.document)
      if (!document) return failure(400, 'badRequest')
      const sealed = await sealPlan(document, base.syncKey, accountId, deps.random)
      if (!sealed) return failure(413, 'tooLarge')
      const write = { accountId, ...sealed, now: seconds(deps) }

      if (baseRevision === 0 ? await store.createPlan(write) : await store.updatePlan(write, { epoch, revision: baseRevision })) {
        return json(200, 'ok', baseRevision === 0 ? { epoch: 1, revision: 1 } : { epoch, revision: baseRevision + 1 })
      }
      const current = await store.readPlan(accountId)
      if (!current) return failure(404, 'noPlan')
      return await planReply(409, baseRevision > 0 && current.epoch !== epoch ? 'replaced' : 'conflict', current, base, accountId)
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
  }, jsonFallback)
}

// --- PUT /api/sync/replace -------------------------------------------------------------------------------------------

export function handleReplacePlan(request: Request, deps: AccountsDeps): Promise<Response> {
  return serve(deps, 'sync.replace', async () => {
    const admitted = await admit(request, deps, { method: 'write', requireJson: true })
    if (isReply(admitted)) return admitted
    const { base, store } = admitted
    const envelope = await readEnvelope(request, ['accountKey', 'document'])
    if ('status' in envelope) return envelope
    const { body } = envelope
    try {
      const authorized = await authorize(request, deps, store, body.accountKey)
      if (!isAuthorized(authorized)) return authorized
      const { accountId } = authorized.session
      const document = parsePlan(body.document)
      if (!document) return failure(400, 'badRequest')
      const sealed = await sealPlan(document, base.syncKey, accountId, deps.random)
      if (!sealed) return failure(413, 'tooLarge')
      const version = await store.replacePlan({ accountId, ...sealed, now: seconds(deps) })
      return version ? json(200, 'ok', version) : failure(401, 'unauthorized')
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
  }, jsonFallback)
}
