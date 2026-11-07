// The storage port for accounts and sync, and its D1 adapter. Every multi-step change is one batch (one transaction
// on D1), and every write that must not outlive an account is conditional on the account row existing in that batch.
import type { D1Like, D1StatementLike } from '../google/connectionStore'

export interface PendingAuth {
  stateHash: string
  flowHash: string
  verifier: string
  nonce: string
  consentVersion: number
  createdAt: number
}

export interface ConsumedPending {
  verifier: string
  nonce: string
  consentVersion: number
}

export interface SessionRow {
  accountId: string
  accountKey: string
  email: string
  consentVersion: number
}

export interface SignUp {
  accountId: string
  accountKey: string
  sub: string
  email: string
  consentVersion: number
  tokenHash: string
  now: number
  idleCutoff: number
}

export interface SignIn {
  accountId: string
  sub: string
  email: string
  tokenHash: string
  replacedTokenHash: string | null
  now: number
}

export interface StoredPlan {
  epoch: number
  revision: number
  format: number
  keyId: string
  payload: Uint8Array<ArrayBuffer>
}

export interface PlanWrite {
  accountId: string
  format: number
  keyId: string
  payload: Uint8Array<ArrayBuffer>
  now: number
}

export interface Version {
  epoch: number
  revision: number
}

export interface AccountsStore {
  /** True when migration 1 has been applied. False (not an error) while the table is missing. */
  migrated(): Promise<boolean>
  /** Writes the pending sign-in and sweeps expired ones, in one batch. */
  putPending(row: PendingAuth, pendingCutoff: number): Promise<void>
  /** Deletes the row matching the state AND the flow cookie in one statement and returns it: single use. */
  consumePending(stateHash: string, flowHash: string, pendingCutoff: number): Promise<ConsumedPending | null>
  isDeleted(accountKey: string): Promise<boolean>
  findAccountId(sub: string): Promise<string | null>
  /** Creates the account, binds the invite and starts the session, all or nothing. False without an unused invite or after deletion. */
  signUp(signUp: SignUp): Promise<boolean>
  /** Starts a session for an existing, invited account. False when the account has no beta access. */
  signIn(signIn: SignIn): Promise<boolean>
  session(tokenHash: string, idleCutoff: number, now: number): Promise<SessionRow | null>
  endSession(tokenHash: string): Promise<void>
  /** Removes the account and everything attached to it and leaves the tombstone, in one batch. */
  deleteAccount(accountId: string): Promise<boolean>
  readPlan(accountId: string): Promise<StoredPlan | null>
  /** True when it created the first copy; false when one already exists or the account is gone. */
  createPlan(write: PlanWrite): Promise<boolean>
  /** Compare-and-swap on (epoch, revision). True when exactly one row changed. */
  updatePlan(write: PlanWrite, expected: Version): Promise<boolean>
  /** Writes the copy under a new epoch (or the first one). Null when the account is gone. */
  replacePlan(write: PlanWrite): Promise<Version | null>
}

export const SQL = {
  migrated: `SELECT 1 AS ok FROM schema_migrations WHERE version = 1`,
  putPending: `INSERT INTO auth_pending (state_hash, flow_hash, verifier, nonce, consent_version, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  sweepPending: `DELETE FROM auth_pending WHERE created_at < ?1`,
  consumePending: `DELETE FROM auth_pending WHERE state_hash = ?1 AND flow_hash = ?2 AND created_at >= ?3 RETURNING verifier, nonce, consent_version`,
  isDeleted: `SELECT 1 AS found FROM deleted_accounts WHERE account_key = ?1`,
  findAccountId: `SELECT account_id FROM identities WHERE sub = ?1`,
  signUpAccount: `INSERT INTO accounts (account_id, account_key, created_at, consent_version, consent_at) SELECT ?1, ?2, ?3, ?4, ?3 WHERE EXISTS (SELECT 1 FROM beta_access WHERE email = ?5 AND account_id IS NULL) AND NOT EXISTS (SELECT 1 FROM deleted_accounts WHERE account_key = ?2)`,
  signUpInvite: `UPDATE beta_access SET account_id = ?1 WHERE email = ?2 AND account_id IS NULL AND EXISTS (SELECT 1 FROM accounts WHERE account_id = ?1)`,
  signUpIdentity: `INSERT INTO identities (sub, account_id, email) SELECT ?1, ?2, ?3 WHERE EXISTS (SELECT 1 FROM accounts WHERE account_id = ?2)`,
  signUpSession: `INSERT INTO sessions (token_hash, account_id, created_at, last_used_at) SELECT ?1, ?2, ?3, ?3 WHERE EXISTS (SELECT 1 FROM accounts WHERE account_id = ?2)`,
  sweepSessions: `DELETE FROM sessions WHERE last_used_at < ?1`,
  signInSession: `INSERT INTO sessions (token_hash, account_id, created_at, last_used_at) SELECT ?1, ?2, ?3, ?3 WHERE EXISTS (SELECT 1 FROM accounts a JOIN beta_access b ON b.account_id = a.account_id WHERE a.account_id = ?2)`,
  signInEmail: `UPDATE identities SET email = ?2 WHERE sub = ?1 AND EXISTS (SELECT 1 FROM sessions WHERE token_hash = ?3)`,
  dropReplacedSession: `DELETE FROM sessions WHERE token_hash = ?1 AND account_id = ?2`,
  session: `SELECT s.account_id, a.account_key, i.email, a.consent_version FROM sessions s JOIN accounts a ON a.account_id = s.account_id JOIN identities i ON i.account_id = a.account_id JOIN beta_access b ON b.account_id = a.account_id WHERE s.token_hash = ?1 AND s.last_used_at >= ?2`,
  // The same validity as `session`: an idle-expired or un-invited session is never refreshed, so a read cannot revive it.
  touchSession: `UPDATE sessions SET last_used_at = ?2 WHERE token_hash = ?1 AND last_used_at < ?3 AND last_used_at >= ?4 AND account_id IN (SELECT account_id FROM beta_access WHERE account_id IS NOT NULL)`,
  endSession: `DELETE FROM sessions WHERE token_hash = ?1`,
  deleteSessions: `DELETE FROM sessions WHERE account_id = ?1`,
  deletePlan: `DELETE FROM plans WHERE account_id = ?1`,
  deleteBeta: `DELETE FROM beta_access WHERE account_id = ?1`,
  deleteIdentities: `DELETE FROM identities WHERE account_id = ?1`,
  tombstone: `INSERT OR IGNORE INTO deleted_accounts (account_key) SELECT account_key FROM accounts WHERE account_id = ?1`,
  deleteAccount: `DELETE FROM accounts WHERE account_id = ?1`,
  readPlan: `SELECT epoch, revision, format, key_id, payload FROM plans WHERE account_id = ?1`,
  createPlan: `INSERT INTO plans (account_id, epoch, revision, format, key_id, payload, updated_at) SELECT ?1, 1, 1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM accounts WHERE account_id = ?1) ON CONFLICT(account_id) DO NOTHING`,
  updatePlan: `UPDATE plans SET revision = revision + 1, format = ?4, key_id = ?5, payload = ?6, updated_at = ?7 WHERE account_id = ?1 AND revision = ?2 AND epoch = ?3 AND EXISTS (SELECT 1 FROM accounts WHERE account_id = ?1)`,
  replacePlan: `INSERT INTO plans (account_id, epoch, revision, format, key_id, payload, updated_at) SELECT ?1, 1, 1, ?2, ?3, ?4, ?5 WHERE EXISTS (SELECT 1 FROM accounts WHERE account_id = ?1) ON CONFLICT(account_id) DO UPDATE SET epoch = plans.epoch + 1, revision = 1, format = excluded.format, key_id = excluded.key_id, payload = excluded.payload, updated_at = excluded.updated_at`,
  versionOf: `SELECT epoch, revision FROM plans WHERE account_id = ?1`,
} as const

interface PlanColumns {
  epoch: number
  revision: number
  format: number
  key_id: string
  payload: unknown
}

// D1 hands a BLOB back as an ArrayBuffer, a typed array or an array of numbers depending on the path; node:sqlite as a Uint8Array.
function toBytes(value: unknown): Uint8Array<ArrayBuffer> {
  if (value instanceof ArrayBuffer) return new Uint8Array(value)
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer)
  if (Array.isArray(value)) return Uint8Array.from(value as number[])
  throw new TypeError('payload is not binary')
}

export function d1AccountsStore(db: D1Like): AccountsStore {
  const one = async <T>(statement: D1StatementLike): Promise<T | undefined> => (await statement.all<T>()).results[0]

  return {
    // Asked on every request, never cached: a purge or a missing migration must show at once as `notConfigured`.
    migrated: async () => {
      try {
        return (await one(db.prepare(SQL.migrated))) !== undefined
      } catch (error) {
        if (/no such table/i.test(error instanceof Error ? error.message : '')) return false
        throw error
      }
    },

    putPending: async (row, pendingCutoff) => {
      await db.batch([
        db.prepare(SQL.sweepPending).bind(pendingCutoff),
        db.prepare(SQL.putPending).bind(row.stateHash, row.flowHash, row.verifier, row.nonce, row.consentVersion, row.createdAt),
      ])
    },

    consumePending: async (stateHash, flowHash, pendingCutoff) => {
      const row = await one<{ verifier: string; nonce: string; consent_version: number }>(db.prepare(SQL.consumePending).bind(stateHash, flowHash, pendingCutoff))
      return row ? { verifier: row.verifier, nonce: row.nonce, consentVersion: row.consent_version } : null
    },

    isDeleted: async (accountKey) => (await one(db.prepare(SQL.isDeleted).bind(accountKey))) !== undefined,

    findAccountId: async (sub) => (await one<{ account_id: string }>(db.prepare(SQL.findAccountId).bind(sub)))?.account_id ?? null,

    signUp: async (s) => {
      const results = await db.batch([
        db.prepare(SQL.signUpAccount).bind(s.accountId, s.accountKey, s.now, s.consentVersion, s.email),
        db.prepare(SQL.signUpInvite).bind(s.accountId, s.email),
        db.prepare(SQL.signUpIdentity).bind(s.sub, s.accountId, s.email),
        db.prepare(SQL.signUpSession).bind(s.tokenHash, s.accountId, s.now),
        db.prepare(SQL.sweepSessions).bind(s.idleCutoff),
      ])
      return results[0]?.meta.changes === 1
    },

    signIn: async (s) => {
      const results = await db.batch([
        db.prepare(SQL.signInSession).bind(s.tokenHash, s.accountId, s.now),
        db.prepare(SQL.signInEmail).bind(s.sub, s.email, s.tokenHash),
        ...(s.replacedTokenHash ? [db.prepare(SQL.dropReplacedSession).bind(s.replacedTokenHash, s.accountId)] : []),
      ])
      return results[0]?.meta.changes === 1
    },

    session: async (tokenHash, idleCutoff, now) => {
      const [read] = await db.batch<{ account_id: string; account_key: string; email: string; consent_version: number }>([
        db.prepare(SQL.session).bind(tokenHash, idleCutoff),
        db.prepare(SQL.touchSession).bind(tokenHash, now, now - 86_400, idleCutoff),
      ])
      const row = read?.results[0]
      return row ? { accountId: row.account_id, accountKey: row.account_key, email: row.email, consentVersion: row.consent_version } : null
    },

    endSession: async (tokenHash) => {
      await db.prepare(SQL.endSession).bind(tokenHash).run()
    },

    deleteAccount: async (accountId) => {
      const results = await db.batch([
        db.prepare(SQL.deleteSessions).bind(accountId),
        db.prepare(SQL.deletePlan).bind(accountId),
        db.prepare(SQL.deleteBeta).bind(accountId),
        db.prepare(SQL.deleteIdentities).bind(accountId),
        db.prepare(SQL.tombstone).bind(accountId),
        db.prepare(SQL.deleteAccount).bind(accountId),
      ])
      return results[5]?.meta.changes === 1
    },

    readPlan: async (accountId) => {
      const row = await one<PlanColumns>(db.prepare(SQL.readPlan).bind(accountId))
      return row ? { epoch: row.epoch, revision: row.revision, format: row.format, keyId: row.key_id, payload: toBytes(row.payload) } : null
    },

    createPlan: async (w) => (await db.prepare(SQL.createPlan).bind(w.accountId, w.format, w.keyId, w.payload.buffer, w.now).run()).meta.changes === 1,

    updatePlan: async (w, expected) =>
      (await db.prepare(SQL.updatePlan).bind(w.accountId, expected.revision, expected.epoch, w.format, w.keyId, w.payload.buffer, w.now).run()).meta.changes === 1,

    replacePlan: async (w) => {
      const [, version] = await db.batch<{ epoch: number; revision: number }>([
        db.prepare(SQL.replacePlan).bind(w.accountId, w.format, w.keyId, w.payload.buffer, w.now),
        db.prepare(SQL.versionOf).bind(w.accountId),
      ])
      const row = version?.results[0]
      return row ? { epoch: row.epoch, revision: row.revision } : null
    },
  }
}
