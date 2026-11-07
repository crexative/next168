// @vitest-environment node
// S1 sync and deletion: account binding, the server's plan on a conflict, noPlan, ETags, epochs, the tombstone.
import { describe, expect, it } from 'vitest'
import { ALICE, BOB, accountKeyOf, server, type Browser, type TestServer } from './testing/harness'
import { smallPlan } from './testing/plans'

async function signedIn(s: TestServer, who = ALICE): Promise<{ b: Browser; key: string }> {
  s.invite(who.email)
  const b = s.browser()
  expect(await b.signIn(who)).toBe('signedIn')
  return { b, key: await accountKeyOf(who.sub) }
}

const plan = (revision: number, workspaceId = 'ws-synthetic-0001') => smallPlan({ revision, workspaceId })

describe('S1 an empty account: noPlan, then a create', () => {
  it('answers 404 noPlan (never 304) for a device that has nothing on the server, then creates the first copy', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    const missing = await b.getPlan(key)
    expect(missing.status).toBe(404)
    expect(missing.body).toEqual({ code: 'noPlan' })
    expect((await b.getPlan(key, '"1.1"')).status).toBe(404)
    expect((await b.getPlan(key, '*')).status).toBe(404)
    const created = await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1) })
    expect(created.status).toBe(200)
    expect(created.body).toEqual({ epoch: 1, revision: 1 })
    expect(s.rows('plans')).toHaveLength(1)
  })

  it('a device that has synced before gets noPlan on a write too, and creates nothing', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    const reply = await b.putPlan({ accountKey: key, baseRevision: 3, epoch: 1, document: plan(4) })
    expect(reply.status).toBe(404)
    expect(reply.body).toEqual({ code: 'noPlan' })
    expect(s.rows('plans')).toEqual([])
  })

  it('"restore it from this device" is a replace, which creates the copy under epoch 1', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    const reply = await b.replacePlan({ accountKey: key, document: plan(9) })
    expect(reply.body).toEqual({ epoch: 1, revision: 1 })
  })
})

describe('S1 the ETag is "<epoch>.<revision>" and a 304 writes nothing', () => {
  it('returns the plan with its ETag, and 304 without a body when it is unchanged', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1) })
    const read = await b.getPlan(key)
    expect(read.status).toBe(200)
    expect(read.headers.get('etag')).toBe('"1.1"')
    expect(read.body).toMatchObject({ epoch: 1, revision: 1, document: plan(1) })
    const rowsBefore = JSON.stringify(s.rows('plans'))
    const same = await b.getPlan(key, '"1.1"')
    expect(same.status).toBe(304)
    expect(same.body).toBeNull()
    expect(same.headers.get('etag')).toBe('"1.1"')
    expect(JSON.stringify(s.rows('plans'))).toBe(rowsBefore)
    await b.putPlan({ accountKey: key, baseRevision: 1, epoch: 1, document: plan(2) })
    expect((await b.getPlan(key, '"1.1"')).status).toBe(200)
    expect((await b.getPlan(key, '"1.2"')).status).toBe(304)
    expect((await b.getPlan(key, '"1.1", "1.2"')).status).toBe(304)
  })

  it('a stored plan is sealed: the row carries no readable plan text, and a row sealed under another key is not served', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1, 'ws-visible-marker') })
    const [row] = s.db.sqlite.prepare('SELECT format, key_id, payload FROM plans').all() as { format: number; key_id: string; payload: Uint8Array }[]
    expect(row!.format).toBe(1)
    expect(Buffer.from(row!.payload).toString('latin1')).not.toContain('ws-visible-marker')
    s.db.sqlite.prepare('UPDATE plans SET key_id = ?').run('someone-elses-key')
    expect((await b.getPlan(key)).status).toBe(503)
  })
})

describe('S1 compare-and-swap, and a 409 carries the server\'s plan', () => {
  it('a write on the current revision advances it', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1) })
    const next = await b.putPlan({ accountKey: key, baseRevision: 1, epoch: 1, document: plan(2) })
    expect(next.status).toBe(200)
    expect(next.body).toEqual({ epoch: 1, revision: 2 })
  })

  it('a write on a stale revision gets 409 conflict with the server\'s epoch, revision and plan, and changes nothing', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1) })
    await b.putPlan({ accountKey: key, baseRevision: 1, epoch: 1, document: plan(2, 'ws-synthetic-0001') })
    const before = JSON.stringify(s.rows('plans'))
    const stale = await b.putPlan({ accountKey: key, baseRevision: 1, epoch: 1, document: plan(77) })
    expect(stale.status).toBe(409)
    expect(stale.body).toMatchObject({ code: 'conflict', epoch: 1, revision: 2, document: plan(2) })
    expect(stale.headers.get('etag')).toBe('"1.2"')
    expect(JSON.stringify(s.rows('plans'))).toBe(before)
  })

  it('a create when a copy already exists is a conflict carrying that copy', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1) })
    const second = await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(5) })
    expect(second.status).toBe(409)
    expect(second.body).toMatchObject({ code: 'conflict', epoch: 1, revision: 1, document: plan(1) })
  })

  it('replace raises the epoch, and a write based on the older epoch gets 409 replaced with the new plan', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1) })
    await b.putPlan({ accountKey: key, baseRevision: 1, epoch: 1, document: plan(2) })
    const replaced = await b.replacePlan({ accountKey: key, document: plan(50, 'ws-synthetic-new') })
    expect(replaced.body).toEqual({ epoch: 2, revision: 1 })
    const late = await b.putPlan({ accountKey: key, baseRevision: 2, epoch: 1, document: plan(3) })
    expect(late.status).toBe(409)
    expect(late.body).toMatchObject({ code: 'replaced', epoch: 2, revision: 1, document: plan(50, 'ws-synthetic-new') })
    expect((await b.getPlan(key, '"1.2"')).status).toBe(200)
    expect((await b.getPlan(key, '"2.1"')).status).toBe(304)
  })

  it('two writes on the same base: exactly one wins', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    await b.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1) })
    const replies = await Promise.all([
      b.putPlan({ accountKey: key, baseRevision: 1, epoch: 1, document: plan(2) }),
      b.putPlan({ accountKey: key, baseRevision: 1, epoch: 1, document: plan(3) }),
    ])
    expect(replies.map((reply) => reply.status).sort()).toEqual([200, 409])
  })
})

describe('S1 account binding: another account\'s key is refused', () => {
  it('a signed-in person naming another account key gets 409 accountMismatch and nothing is read or written', async () => {
    const s = server()
    const alice = await signedIn(s)
    const bob = await signedIn(s, BOB)
    await alice.b.putPlan({ accountKey: alice.key, baseRevision: 0, epoch: 0, document: plan(1) })
    const read = await bob.b.getPlan(alice.key)
    expect(read.status).toBe(409)
    expect(read.body).toEqual({ code: 'accountMismatch' })
    expect(JSON.stringify(read.body)).not.toContain('ws-synthetic')
    const write = await bob.b.putPlan({ accountKey: alice.key, baseRevision: 1, epoch: 1, document: plan(9) })
    expect(write.status).toBe(409)
    expect((await bob.b.replacePlan({ accountKey: alice.key, document: plan(9) })).status).toBe(409)
    expect(s.rows('plans')).toHaveLength(1)
    expect((await alice.b.getPlan(alice.key)).body).toMatchObject({ revision: 1 })
  })

  it('no session at all is 401, and a malformed key is 400', async () => {
    const s = server()
    const { key } = await signedIn(s)
    const stranger = s.browser()
    expect((await stranger.getPlan(key)).status).toBe(401)
    expect((await stranger.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(1) })).status).toBe(401)
    expect((await stranger.replacePlan({ accountKey: key, document: plan(1) })).status).toBe(401)
    const b = await signedIn(server())
    expect((await b.b.getPlan('short')).status).toBe(400)
    expect((await b.b.getPlan('')).status).toBe(400)
  })
})

describe('S1 deleting an account and the tombstone', () => {
  async function accountWithPlan(s: TestServer) {
    const account = await signedIn(s)
    await account.b.putPlan({ accountKey: account.key, baseRevision: 0, epoch: 0, document: plan(1) })
    return account
  }

  it('leaves zero rows in every account table except the tombstone, which holds only the hash', async () => {
    const s = server()
    const { b, key } = await accountWithPlan(s)
    const bob = await signedIn(s, BOB)
    const accountId = String(s.rows('accounts').find((row) => row.account_key === key)!.account_id)
    const reply = await b.deleteAccount(key)
    expect(reply.status).toBe(200)
    expect(b.session).toBeUndefined()
    for (const table of ['accounts', 'identities', 'sessions', 'plans', 'beta_access']) {
      expect(s.rows(table).filter((row) => row.account_id === accountId), table).toEqual([])
    }
    expect(s.rows('accounts').map((row) => row.account_key)).toEqual([bob.key])
    expect(s.rows('identities')).toHaveLength(1)
    expect(s.rows('sessions')).toHaveLength(1)
    expect(s.rows('plans')).toEqual([])
    expect(s.rows('beta_access').filter((row) => row.email === ALICE.email)).toEqual([])
    expect(s.rows('deleted_accounts')).toEqual([{ account_key: key }])
    expect(Object.keys(s.rows('deleted_accounts')[0]!)).toEqual(['account_key'])
    expect(JSON.stringify(s.rows('deleted_accounts'))).not.toContain(ALICE.sub)
    expect(JSON.stringify(s.rows('deleted_accounts'))).not.toContain('alice')
  })

  it('deleting the only account leaves nothing but the tombstone anywhere', async () => {
    const s = server()
    const { b, key } = await accountWithPlan(s)
    await b.deleteAccount(key)
    for (const table of ['accounts', 'identities', 'sessions', 'plans', 'beta_access', 'auth_pending']) expect(s.rows(table), table).toEqual([])
    expect(s.rows('deleted_accounts')).toHaveLength(1)
  })

  it('a later sign-in with the same Google identity is refused with accountDeleted, even with a new invite', async () => {
    const s = server()
    const { b, key } = await accountWithPlan(s)
    await b.deleteAccount(key)
    s.invite(ALICE.email)
    const again = s.browser()
    expect(await again.signIn(ALICE)).toBe('accountDeleted')
    expect(again.session).toBeUndefined()
    expect(s.rows('sessions')).toEqual([])
    expect(s.rows('accounts')).toEqual([])
    expect(s.rows('identities')).toEqual([])
  })

  it('a later sync for that key is 410 accountDeleted, with or without a stale cookie, on every route', async () => {
    const s = server()
    const { b, key } = await accountWithPlan(s)
    const staleCookie = b.session!
    await b.deleteAccount(key)
    const stale = s.browser()
    stale.jar.set('__Host-wl_ses', staleCookie)
    for (const device of [stale, s.browser()]) {
      for (const reply of [
        await device.getPlan(key),
        await device.getPlan(key, '"1.1"'),
        await device.putPlan({ accountKey: key, baseRevision: 1, epoch: 1, document: plan(2) }),
        await device.putPlan({ accountKey: key, baseRevision: 0, epoch: 0, document: plan(2) }),
        await device.replacePlan({ accountKey: key, document: plan(2) }),
      ]) {
        expect(reply.status).toBe(410)
        expect(reply.body).toEqual({ code: 'accountDeleted' })
      }
    }
    expect(s.rows('plans')).toEqual([])
  })

  it('the tombstone also refuses a different signed-in account that names the deleted key', async () => {
    const s = server()
    const { b, key } = await accountWithPlan(s)
    const bob = await signedIn(s, BOB)
    await b.deleteAccount(key)
    expect((await bob.b.getPlan(key)).status).toBe(410)
  })

  it('a write already in flight at deletion cannot bring the plan back', async () => {
    const s = server()
    const { b, key } = await accountWithPlan(s)
    await b.deleteAccount(key)
    // A write that lands after the deletion batch: the account row is gone, so neither the guarded create nor the guarded update writes.
    const store = s.deps.store!
    const write = { accountId: 'any-account-id', format: 1, keyId: 'k', payload: new Uint8Array([1, 2, 3]), now: 1 }
    expect(await store.createPlan(write)).toBe(false)
    expect(await store.updatePlan(write, { epoch: 1, revision: 1 })).toBe(false)
    expect(await store.replacePlan(write)).toBeNull()
    expect(s.rows('plans')).toEqual([])
  })

  it('a delete naming another key, or without a session, deletes nothing', async () => {
    const s = server()
    const alice = await accountWithPlan(s)
    const bob = await signedIn(s, BOB)
    expect((await alice.b.deleteAccount(bob.key)).status).toBe(409)
    expect((await s.browser().deleteAccount(alice.key)).status).toBe(401)
    expect((await alice.b.call('auth/delete', {})).status).toBe(400)
    expect(s.rows('accounts')).toHaveLength(2)
    expect(s.rows('deleted_accounts')).toEqual([])
  })

  it('the deleted person\'s seat in the beta is released', async () => {
    const s = server()
    const { b, key } = await accountWithPlan(s)
    await b.deleteAccount(key)
    expect(s.rows('beta_access')).toEqual([])
  })
})
