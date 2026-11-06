// @vitest-environment node
// S-11: the rollback purge, statement by statement, with a callback, a rotating mint and a disconnect in flight.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EPOCH_B, server, type TestServer } from './testing/harness'

const PURGE = readFileSync(new URL('./purge.sql', import.meta.url), 'utf8')
  .split('\n').filter((line) => !line.startsWith('--')).join('\n')
  .split(';').map((statement) => statement.trim()).filter(Boolean)

function counts(s: TestServer): { pending: number; credentials: number } {
  const row = s.db.sqlite.prepare(PURGE[2]!).get() as { pending: number; credentials: number }
  return { pending: row.pending, credentials: row.credentials }
}

describe('S-11 purge', () => {
  it('has the pending delete first, then the credentials, then the read-back', () => {
    expect(PURGE).toEqual([
      'DELETE FROM google_pending',
      'DELETE FROM google_credentials',
      'SELECT (SELECT count(*) FROM google_pending) AS pending, (SELECT count(*) FROM google_credentials) AS credentials',
    ])
  })

  it('a callback held after its lookup and exchange, released between the two deletes → cancelled, 0 | 0', async () => {
    const s = server()
    const connected = s.browser()
    expect(await connected.consent()).toBe('connected')
    const browser = s.browser()
    const { state, challenge } = await browser.connect()
    const held = s.store.hold('commit')
    const callback = browser.callback({ state, code: s.google.issueCode({ challenge }) })
    await held.reached
    expect(s.google.count('exchange')).toBe(2)
    s.db.sqlite.exec(PURGE[0]!)
    held.release()
    expect((await callback).result).toBe('cancelled')
    s.db.sqlite.exec(PURGE[1]!)
    expect(counts(s)).toEqual({ pending: 0, credentials: 0 })
  })

  it('a mint held with a rotated token, released after the purge → 0 | 0 (rotate never inserts)', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    await browser.connect(EPOCH_B)
    s.google.rotateNextTo = 'rt-SECRET-rotated'
    const held = s.google.hold('refresh')
    const mint = browser.mint()
    await held.reached
    s.db.sqlite.exec(PURGE[0]!)
    s.db.sqlite.exec(PURGE[1]!)
    held.release()
    expect((await mint).status).toBe(200)
    expect(counts(s)).toEqual({ pending: 0, credentials: 0 })
  })

  it('a disconnect held before its batch, released after the purge → none, 0 | 0', async () => {
    const s = server()
    const browser = s.browser()
    expect(await browser.consent()).toBe('connected')
    const gen = String((await browser.status()).body!.gen)
    const held = s.store.hold('disconnect')
    const disconnect = browser.disconnect(gen)
    await held.reached
    for (const statement of PURGE.slice(0, 2)) s.db.sqlite.exec(statement)
    held.release()
    expect((await disconnect).body).toEqual({ result: 'none' })
    expect(counts(s)).toEqual({ pending: 0, credentials: 0 })
    expect(s.google.count('revoke')).toBe(0)
  })
})
