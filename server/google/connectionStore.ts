// The storage port and its D1 adapter. Every statement is the one in the design (§4.3, §4.4); timestamps are Unix
// seconds, and every age limit is bound as a cutoff computed from the caller's clock.

export interface D1StatementLike {
  bind(...values: unknown[]): D1StatementLike
  all<T = Record<string, unknown>>(): Promise<{ results: T[]; meta: { changes: number } }>
  run(): Promise<{ meta: { changes: number } }>
}

export interface D1Like {
  prepare(sql: string): D1StatementLike
  batch<T = Record<string, unknown>>(statements: D1StatementLike[]): Promise<{ results: T[]; meta: { changes: number } }[]>
}

export type ReturnTo = 'app' | 'canary'

export interface PendingRow {
  deviceHash: string
  pendingId: string
  stateHash: string
  verifier: string
  keyId: string
  epoch: string
  returnTo: ReturnTo
  createdAt: number
}

export interface PendingLookup {
  deviceHash: string
  verifier: string
  keyId: string
  returnTo: ReturnTo
}

export interface SealedToken {
  keyId: string
  iv: string
  ciphertext: string
}

export interface CredentialRow extends SealedToken {
  connectionId: string
  epoch: string
}

export interface Commit extends SealedToken {
  deviceHash: string
  stateHash: string
  connectionId: string
  now: number
  pendingCutoff: number
  credentialCutoff: number
}

export interface Generation {
  connectionId: string | null
  pendingId: string | null
}

export interface DisconnectResult {
  deleted: SealedToken | null
  pendingDeleted: boolean
  after: Generation
}

export interface Sweep {
  pendingCutoff: number
  credentialCutoff: number
}

export interface ConnectionStore {
  /** Writes the device's pending row and sweeps expired pending rows, in one batch. */
  upsertPending(row: PendingRow, pendingCutoff: number): Promise<void>
  findPending(stateHash: string, pendingCutoff: number): Promise<PendingLookup | null>
  /** Inserts the credential from the pending row, deletes that row and sweeps, in one batch. True when committed. */
  commit(commit: Commit): Promise<boolean>
  /** Deletes one device's pending row with that state; returns the number of rows deleted. */
  deletePending(deviceHash: string, stateHash: string): Promise<number>
  mintRead(deviceHash: string, pendingCutoff: number): Promise<{ credential: CredentialRow | null; pending: boolean }>
  touch(deviceHash: string, connectionId: string, now: number): Promise<number>
  rotate(deviceHash: string, connectionId: string, token: SealedToken): Promise<number>
  deleteCredential(deviceHash: string, connectionId: string): Promise<number>
  sweep(sweep: Sweep): Promise<void>
  status(deviceHash: string, pendingCutoff: number): Promise<Generation>
  disconnect(deviceHash: string, expected: Generation, pendingCutoff: number): Promise<DisconnectResult>
}

export const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS google_pending (
  device_hash TEXT PRIMARY KEY,
  pending_id  TEXT NOT NULL,
  state_hash  TEXT NOT NULL UNIQUE,
  verifier    TEXT NOT NULL,
  key_id      TEXT NOT NULL,
  epoch       TEXT NOT NULL,
  return_to   TEXT NOT NULL CHECK (return_to IN ('app','canary')),
  created_at  INTEGER NOT NULL
) STRICT`,
  `CREATE TABLE IF NOT EXISTS google_credentials (
  device_hash   TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  epoch         TEXT NOT NULL,
  key_id        TEXT NOT NULL,
  iv            TEXT NOT NULL,
  ciphertext    TEXT NOT NULL,
  created_at    INTEGER NOT NULL,
  last_used_at  INTEGER NOT NULL
) STRICT`,
] as const

export const SQL = {
  connect: `INSERT OR REPLACE INTO google_pending (device_hash, pending_id, state_hash, verifier, key_id, epoch, return_to, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  callbackLookup: `SELECT device_hash, verifier, key_id, return_to FROM google_pending WHERE state_hash = ?1 AND created_at >= ?2`,
  commitInsert: `INSERT INTO google_credentials (device_hash, connection_id, epoch, key_id, iv, ciphertext, created_at, last_used_at) SELECT device_hash, ?3, epoch, ?4, ?5, ?6, ?7, ?7 FROM google_pending WHERE device_hash = ?1 AND state_hash = ?2 AND created_at >= ?8 ON CONFLICT(device_hash) DO UPDATE SET connection_id = excluded.connection_id, epoch = excluded.epoch, key_id = excluded.key_id, iv = excluded.iv, ciphertext = excluded.ciphertext, last_used_at = excluded.last_used_at`,
  deletePending: `DELETE FROM google_pending WHERE device_hash = ?1 AND state_hash = ?2`,
  mintCredential: `SELECT connection_id, epoch, key_id, iv, ciphertext FROM google_credentials WHERE device_hash = ?1`,
  mintPending: `SELECT EXISTS (SELECT 1 FROM google_pending WHERE device_hash = ?1 AND created_at >= ?2) AS pending`,
  touch: `UPDATE google_credentials SET last_used_at = ?3 WHERE device_hash = ?1 AND connection_id = ?2`,
  rotate: `UPDATE google_credentials SET key_id = ?3, iv = ?4, ciphertext = ?5 WHERE device_hash = ?1 AND connection_id = ?2`,
  invalidGrant: `DELETE FROM google_credentials WHERE device_hash = ?1 AND connection_id = ?2`,
  status: `SELECT (SELECT connection_id FROM google_credentials WHERE device_hash = ?1) AS c, (SELECT pending_id FROM google_pending WHERE device_hash = ?1 AND created_at >= ?2) AS p`,
  sweepPending: `DELETE FROM google_pending WHERE created_at < ?1`,
  sweepCredentials: `DELETE FROM google_credentials WHERE last_used_at < ?1`,
  // Generation-fenced disconnect (§4.4): ?1 device, ?2 connection id or NULL, ?3 pending id or NULL, ?4 pending cutoff.
  disconnectCredential: `DELETE FROM google_credentials WHERE device_hash = ?1 AND connection_id = ?2 AND (SELECT pending_id FROM google_pending WHERE device_hash = ?1 AND created_at >= ?4) IS ?3 RETURNING key_id, iv, ciphertext`,
  disconnectPending: `DELETE FROM google_pending WHERE device_hash = ?1 AND pending_id = ?3 AND created_at >= ?4 AND (SELECT connection_id FROM google_credentials WHERE device_hash = ?1) IS NULL AND (?2 IS NULL OR changes() = 1)`,
} as const

// D10: the schema is created once per isolate (per database object), on first use.
const schemaReady = new WeakMap<D1Like, Promise<unknown>>()

function ensureSchema(db: D1Like): Promise<unknown> {
  let ready = schemaReady.get(db)
  if (!ready) {
    ready = db.batch(SCHEMA.map((sql) => db.prepare(sql)))
    ready.catch(() => schemaReady.delete(db))
    schemaReady.set(db, ready)
  }
  return ready
}

interface CredentialColumns {
  connection_id: string
  epoch: string
  key_id: string
  iv: string
  ciphertext: string
}

export function d1ConnectionStore(db: D1Like): ConnectionStore {
  const ready = async <T>(work: () => Promise<T>): Promise<T> => {
    await ensureSchema(db)
    return work()
  }
  const sweepStatements = (s: Sweep): D1StatementLike[] => [
    db.prepare(SQL.sweepPending).bind(s.pendingCutoff),
    db.prepare(SQL.sweepCredentials).bind(s.credentialCutoff),
  ]
  const generationOf = (row: { c: string | null; p: string | null } | undefined): Generation => ({
    connectionId: row?.c ?? null,
    pendingId: row?.p ?? null,
  })

  return {
    upsertPending: (row, pendingCutoff) => ready(async () => {
      await db.batch([
        db.prepare(SQL.connect).bind(row.deviceHash, row.pendingId, row.stateHash, row.verifier, row.keyId, row.epoch, row.returnTo, row.createdAt),
        db.prepare(SQL.sweepPending).bind(pendingCutoff),
      ])
    }),

    findPending: (stateHash, pendingCutoff) => ready(async () => {
      const { results } = await db.prepare(SQL.callbackLookup).bind(stateHash, pendingCutoff)
        .all<{ device_hash: string; verifier: string; key_id: string; return_to: ReturnTo }>()
      const row = results[0]
      return row ? { deviceHash: row.device_hash, verifier: row.verifier, keyId: row.key_id, returnTo: row.return_to } : null
    }),

    commit: (c) => ready(async () => {
      const [inserted] = await db.batch([
        db.prepare(SQL.commitInsert).bind(c.deviceHash, c.stateHash, c.connectionId, c.keyId, c.iv, c.ciphertext, c.now, c.pendingCutoff),
        db.prepare(SQL.deletePending).bind(c.deviceHash, c.stateHash),
        ...sweepStatements(c),
      ])
      return inserted?.meta.changes === 1
    }),

    deletePending: (deviceHash, stateHash) => ready(async () => {
      const { meta } = await db.prepare(SQL.deletePending).bind(deviceHash, stateHash).run()
      return meta.changes
    }),

    mintRead: (deviceHash, pendingCutoff) => ready(async () => {
      const [credential, pending] = await db.batch([
        db.prepare(SQL.mintCredential).bind(deviceHash),
        db.prepare(SQL.mintPending).bind(deviceHash, pendingCutoff),
      ])
      const row = credential?.results[0] as unknown as CredentialColumns | undefined
      const exists = (pending?.results[0] as { pending: number } | undefined)?.pending === 1
      return {
        credential: row ? { connectionId: row.connection_id, epoch: row.epoch, keyId: row.key_id, iv: row.iv, ciphertext: row.ciphertext } : null,
        pending: exists,
      }
    }),

    touch: (deviceHash, connectionId, now) => ready(async () => (await db.prepare(SQL.touch).bind(deviceHash, connectionId, now).run()).meta.changes),

    rotate: (deviceHash, connectionId, token) => ready(async () =>
      (await db.prepare(SQL.rotate).bind(deviceHash, connectionId, token.keyId, token.iv, token.ciphertext).run()).meta.changes),

    deleteCredential: (deviceHash, connectionId) => ready(async () => (await db.prepare(SQL.invalidGrant).bind(deviceHash, connectionId).run()).meta.changes),

    sweep: (s) => ready(async () => {
      await db.batch(sweepStatements(s))
    }),

    status: (deviceHash, pendingCutoff) => ready(async () => {
      const { results } = await db.prepare(SQL.status).bind(deviceHash, pendingCutoff).all<{ c: string | null; p: string | null }>()
      return generationOf(results[0])
    }),

    disconnect: (deviceHash, expected, pendingCutoff) => ready(async () => {
      const [credential, pending, after] = await db.batch([
        db.prepare(SQL.disconnectCredential).bind(deviceHash, expected.connectionId, expected.pendingId, pendingCutoff),
        db.prepare(SQL.disconnectPending).bind(deviceHash, expected.connectionId, expected.pendingId, pendingCutoff),
        db.prepare(SQL.status).bind(deviceHash, pendingCutoff),
      ])
      const deleted = credential?.results[0] as { key_id: string; iv: string; ciphertext: string } | undefined
      return {
        deleted: deleted ? { keyId: deleted.key_id, iv: deleted.iv, ciphertext: deleted.ciphertext } : null,
        pendingDeleted: (pending?.meta.changes ?? 0) > 0,
        after: generationOf(after?.results[0] as { c: string | null; p: string | null } | undefined),
      }
    }),
  }
}
