// @vitest-environment node
// Migration 1 (design 2.4): additive and versioned, tested against a database built from today's S1b SCHEMA with rows in it.
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { SCHEMA } from '../google/connectionStore'
import { server as googleServer } from '../google/testing/harness'
import type { SqliteD1 } from '../google/testing/sqliteD1'
import { ALICE, BOB, MIGRATION_SQL, PURGE_SQL, accountKeyOf, migrate, server } from './testing/harness'
import { smallPlan } from './testing/plans'

const S1B_TABLES = ['google_credentials', 'google_pending']
const ACCOUNT_TABLES = ['accounts', 'auth_pending', 'beta_access', 'deleted_accounts', 'identities', 'plans', 'schema_migrations', 'sessions']

const names = (db: SqliteD1): string[] =>
  (db.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as { name: string }[]).map((row) => row.name)

const definitions = (db: SqliteD1, tables: string[]): { name: string; sql: string }[] =>
  db.sqlite.prepare(`SELECT name, sql FROM sqlite_master WHERE name IN (${tables.map(() => '?').join(',')}) ORDER BY name`).all(...tables) as { name: string; sql: string }[]

const dump = (db: SqliteD1, tables: string[]): string => JSON.stringify(tables.map((table) => [table, db.rows(table)]))

/** A database built from today's S1b schema, with a connected device and a pending authorization in it (synthetic). */
async function s1bDatabaseWithRows() {
  const g = googleServer()
  const connected = g.browser()
  expect(await connected.consent()).toBe('connected')
  await g.browser().connect()
  await g.browser().connect()
  expect(g.db.rows('google_credentials')).toHaveLength(1)
  expect(g.db.rows('google_pending')).toHaveLength(2)
  return g
}

describe('migration 1 applied to the S1b schema with data in it', () => {
  it('starts from exactly the S1b tables', async () => {
    const g = await s1bDatabaseWithRows()
    expect(names(g.db)).toEqual(S1B_TABLES)
    expect(SCHEMA).toHaveLength(2)
  })

  it('adds the account tables and leaves every S1b table definition and row byte for byte as it was', async () => {
    const g = await s1bDatabaseWithRows()
    const definitionsBefore = definitions(g.db, S1B_TABLES)
    const rowsBefore = dump(g.db, S1B_TABLES)
    migrate(g.db)
    expect(names(g.db)).toEqual([...ACCOUNT_TABLES, ...S1B_TABLES].sort())
    expect(definitions(g.db, S1B_TABLES)).toEqual(definitionsBefore)
    expect(dump(g.db, S1B_TABLES)).toBe(rowsBefore)
    expect(g.db.rows('schema_migrations').map((row) => row.version)).toEqual([1])
  })

  it('the S1b routes keep working over the migrated database: mint, status and disconnect', async () => {
    const g = await s1bDatabaseWithRows()
    migrate(g.db)
    const again = googleServer({ DB: g.db })
    const device = again.browser()
    expect(await device.consent()).toBe('connected')
    expect((await device.mint()).status).toBe(200)
    const status = (await device.status()).body!
    expect(status.connected).toBe(true)
    expect((await device.disconnect(String(status.gen), false)).body).toEqual({ result: 'forgotten' })
  })

  it('a second run is a no-op', async () => {
    const g = await s1bDatabaseWithRows()
    migrate(g.db)
    const s = server({ DB: g.db })
    s.invite(ALICE.email)
    expect(await s.browser().signIn(ALICE)).toBe('signedIn')
    const everything = [...S1B_TABLES, ...ACCOUNT_TABLES]
    const before = dump(g.db, everything)
    const shape = JSON.stringify(definitions(g.db, everything))
    migrate(g.db)
    migrate(g.db)
    expect(dump(g.db, everything)).toBe(before)
    expect(JSON.stringify(definitions(g.db, everything))).toBe(shape)
    expect(g.db.rows('schema_migrations')).toHaveLength(1)
  })

  it('purge returns the database to the S1b-only state, S1b rows intact, and the routes answer notConfigured', async () => {
    const g = await s1bDatabaseWithRows()
    const definitionsBefore = definitions(g.db, S1B_TABLES)
    const rowsBefore = dump(g.db, S1B_TABLES)
    migrate(g.db)
    const s = server({ DB: g.db })
    s.invite(ALICE.email)
    s.invite(BOB.email)
    const b = s.browser()
    expect(await b.signIn(ALICE)).toBe('signedIn')
    const key = await accountKeyOf(ALICE.sub)
    await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: smallPlan() })
    await b.deleteAccount(key)
    expect(g.db.rows('deleted_accounts')).toHaveLength(1)
    g.db.sqlite.exec(PURGE_SQL)
    expect(names(g.db)).toEqual(S1B_TABLES)
    expect(definitions(g.db, S1B_TABLES)).toEqual(definitionsBefore)
    expect(dump(g.db, S1B_TABLES)).toBe(rowsBefore)
    const after = server({ DB: g.db })
    const reply = await after.browser().call('auth/session')
    expect(reply.status).toBe(503)
    expect(reply.body).toEqual({ code: 'notConfigured' })
    // The owner can apply the migration again later.
    migrate(g.db)
    expect((await after.browser().call('auth/session')).status).toBe(200)
  })

  it('the purge runs in the order the design requires: sessions, then pending rows, then everything else', () => {
    const deletes = [...PURGE_SQL.matchAll(/^DELETE FROM (\w+);/gm)].map((match) => match[1])
    expect(deletes.slice(0, 2)).toEqual(['sessions', 'auth_pending'])
    expect(new Set(deletes)).toEqual(new Set(['sessions', 'auth_pending', 'plans', 'beta_access', 'identities', 'accounts', 'deleted_accounts']))
  })
})

describe('migration 1 as a file', () => {
  it('only creates: no ALTER, DROP, UPDATE or DELETE, and no mention of an S1b table', () => {
    const code = MIGRATION_SQL.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n')
    expect(code).not.toMatch(/\b(ALTER|DROP|UPDATE|DELETE|REPLACE)\b/i)
    expect(code).not.toMatch(/google_/i)
    expect(code.match(/^\s*CREATE TABLE/gim)?.length).toBe(ACCOUNT_TABLES.length)
    for (const statement of code.match(/CREATE (TABLE|INDEX|TRIGGER)[^;]*/g) ?? []) expect(statement).toMatch(/IF NOT EXISTS/)
  })

  it('works on an empty database too', () => {
    const s = server({}, { unmigrated: true })
    migrate(s.db)
    migrate(s.db)
    expect(names(s.db)).toEqual(ACCOUNT_TABLES)
  })

  it('the S1b server code never reads an account table, so an old worker is unaffected', () => {
    const dir = fileURLToPath(new URL('../google/', import.meta.url))
    const sources = readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.endsWith('.spec.ts')).map((name) => readFileSync(dir + name, 'utf8'))
    const text = sources.join('\n').replace(/\/\/.*$/gm, '')
    for (const table of ACCOUNT_TABLES) expect(new RegExp(`\\b(FROM|INTO|JOIN|UPDATE|TABLE|EXISTS)\\s+${table}\\b`, 'i').test(text), table).toBe(false)
  })
})

describe('migration 1 constraints', () => {
  it('lists at most 100 people in the beta: the 101st invitation fails', () => {
    const s = server()
    const insert = (email: string) => s.db.sqlite.prepare('INSERT INTO beta_access (email, created_at) VALUES (?, 0)').run(email)
    for (let i = 0; i < 100; i++) insert(`person${i}@example.com`)
    expect(() => insert('person100@example.com')).toThrow(/beta is full/)
    expect(s.rows('beta_access')).toHaveLength(100)
  })

  it('a released seat can be given again', () => {
    const s = server()
    for (let i = 0; i < 100; i++) s.invite(`person${i}@example.com`)
    s.db.sqlite.prepare('DELETE FROM beta_access WHERE email = ?').run('person7@example.com')
    expect(() => s.invite('person101@example.com')).not.toThrow()
  })

  it('invitations must be lowercase and unique', () => {
    const s = server()
    expect(() => s.invite('Mixed.Case@example.com')).toThrow(/CHECK/i)
    s.invite('one@example.com')
    expect(() => s.invite('one@example.com')).toThrow(/UNIQUE|PRIMARY/i)
  })

  it('every table is STRICT, so a wrong column type cannot be stored', () => {
    const s = server()
    expect(() => s.db.sqlite.prepare('INSERT INTO sessions (token_hash, account_id, created_at, last_used_at) VALUES (?, ?, ?, ?)').run('h', 'a', 'not a number', 0)).toThrow()
  })
})
