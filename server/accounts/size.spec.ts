// @vitest-environment node
// S0 size and input bounds: what the plan weighs at the schema maxima and for a heavy realistic plan, and what /api/sync
// refuses before it reads, compresses or seals anything.
//
// MEASURED CONFLICT WITH THE DESIGN (docs/design/accounts-and-sync.md S0): a plan at the array maxima of
// `plannerDocumentSchema` is 15.8 MB serialized and 2.3 MB sealed even with repetitive text (21.4 MB sealed with random
// text), above the 1.9 MB gate. It cannot sync; the design's stated fallback applies (v1 refuses to push, "plan too large
// to sync"). The tests below pin that fallback and the sizes that do sync; they do not claim the gate holds.
import { describe, expect, it } from 'vitest'
import { fromBase64 } from '../google/crypto'
import { MAX_BODY_BYTES, MAX_STORED_BYTES, measurePlan, sealPlan, type PlannerDocument } from './planCodec'
import { systemRandom } from '../google/crypto'
import { ALICE, SYNC_KEY, accountKeyOf, server, type Browser, type TestServer } from './testing/harness'
import { HEAVY, planAtMaxima, planWithCounts, smallPlan } from './testing/plans'

const KEY = fromBase64(SYNC_KEY)!

async function signedIn(s: TestServer): Promise<{ b: Browser; key: string }> {
  s.invite(ALICE.email)
  const b = s.browser()
  expect(await b.signIn(ALICE)).toBe('signedIn')
  return { b, key: await accountKeyOf(ALICE.sub) }
}

const body = (key: string, document: unknown) => ({ accountKey: key, baseRevision: 0, epoch: 0, document })

/** A valid document whose serialized form is about `targetBytes`, filled with random text so it cannot compress. */
function incompressibleOfSize(targetBytes: number): PlannerDocument {
  const perTask = planWithCounts({ ...HEAVY, categories: 1, blocks: 1, tasks: 1, checkIns: 0, actuals: 0, events: 0, calendarSources: 0, appliedIds: 0 }, 'incompressible')
  const baseline = JSON.stringify(smallPlan()).length
  const taskBytes = JSON.stringify(perTask.tasks[0]).length + 1
  const tasks = Math.floor((targetBytes - baseline) / taskBytes)
  return planWithCounts({ ...HEAVY, categories: 1, blocks: 1, tasks, checkIns: 0, actuals: 0, events: 0, calendarSources: 0, appliedIds: 0 }, 'incompressible')
}

describe('S0 the limits', () => {
  it('are the design\'s: bodies above 2 MB are refused, rows stay under 1.9 MB, below D1\'s 2 MB row limit', () => {
    expect(MAX_BODY_BYTES).toBe(2_000_000)
    expect(MAX_STORED_BYTES).toBe(1_900_000)
    expect(MAX_STORED_BYTES).toBeLessThan(2_000_000)
  })

  it('the database itself refuses a row above 1.9 MB, whatever the application does', () => {
    const s = server()
    s.invite('x@example.com')
    const insert = (size: number) => s.db.sqlite.prepare('INSERT INTO plans (account_id, epoch, revision, format, key_id, payload, updated_at) VALUES (?, 1, 1, 1, ?, ?, 0)')
      .run(`a${size}`, 'k', new Uint8Array(size))
    expect(() => insert(MAX_STORED_BYTES)).not.toThrow()
    expect(() => insert(MAX_STORED_BYTES + 1)).toThrow(/CHECK/i)
  })
})

describe('S0 what the plan weighs', () => {
  it('a heavy realistic plan (a year of use) syncs, far under both limits', async () => {
    const plan = planWithCounts(HEAVY, 'realistic')
    const { jsonBytes, sealedBytes } = await measurePlan(plan, KEY, systemRandom)
    expect(jsonBytes).toBeLessThan(MAX_BODY_BYTES)
    expect(sealedBytes).toBeLessThan(MAX_STORED_BYTES / 4)
    const s = server()
    const { b, key } = await signedIn(s)
    const put = await b.putPlan(body(key, plan))
    expect(put.status, JSON.stringify(put.body)).toBe(200)
    const [stored] = s.db.sqlite.prepare('SELECT length(payload) AS bytes FROM plans').all() as { bytes: number }[]
    expect(Math.abs(stored!.bytes - sealedBytes)).toBeLessThan(64)
    expect(stored!.bytes).toBeLessThanOrEqual(MAX_STORED_BYTES)
    const read = await b.getPlan(key)
    expect(read.body!.document).toEqual(plan)
  }, 60_000)

  it('a plan at the schema maxima exceeds both budgets, so the sizes are what the design feared', async () => {
    const { jsonBytes, sealedBytes } = await measurePlan(planAtMaxima('realistic'), KEY, systemRandom)
    expect(jsonBytes).toBeGreaterThan(MAX_BODY_BYTES)
    expect(sealedBytes).toBeGreaterThan(MAX_STORED_BYTES)
  }, 120_000)

  it('the fallback: a plan at the schema maxima is refused with 413 and nothing is stored', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    const reply = await b.putPlan(body(key, planAtMaxima('realistic')))
    expect(reply.status).toBe(413)
    expect(reply.body).toEqual({ code: 'tooLarge' })
    expect(s.rows('plans')).toEqual([])
  }, 120_000)

  it('the worst case that passes the body limit (random printable text, 2 MB) still seals under the row cap', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    const document = incompressibleOfSize(1_990_000)
    const raw = JSON.stringify(body(key, document))
    expect(raw.length).toBeLessThan(MAX_BODY_BYTES)
    expect(raw.length).toBeGreaterThan(MAX_BODY_BYTES - 50_000)
    const reply = await b.putPlan(body(key, document))
    expect(reply.status, JSON.stringify(reply.body).slice(0, 200)).toBe(200)
    const [stored] = s.db.sqlite.prepare('SELECT length(payload) AS bytes FROM plans').all() as { bytes: number }[]
    expect(stored!.bytes).toBeLessThanOrEqual(MAX_STORED_BYTES)
  }, 60_000)

  it('sealing refuses a payload above the cap it is given (the guard behind the body limit)', async () => {
    const plan = smallPlan()
    const { sealedBytes } = await measurePlan(plan, KEY, systemRandom)
    expect(await sealPlan(plan, KEY, 'a', systemRandom, sealedBytes - 1)).toBeNull()
    expect(await sealPlan(plan, KEY, 'a', systemRandom, sealedBytes)).not.toBeNull()
  })

  it('random text of 1.7 MB is stored under 1.9 MB', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    const document = incompressibleOfSize(1_700_000)
    const reply = await b.putPlan(body(key, document))
    expect(reply.status, JSON.stringify(reply.body).slice(0, 200)).toBe(200)
    const [stored] = s.db.sqlite.prepare('SELECT length(payload) AS bytes FROM plans').all() as { bytes: number }[]
    expect(stored!.bytes).toBeLessThanOrEqual(MAX_STORED_BYTES)
    expect(stored!.bytes).toBeGreaterThan(1_000_000)
  }, 60_000)
})

describe('S0 the body is bounded before it is read in full', () => {
  function stream(chunks: number, chunkBytes: number): { body: ReadableStream<Uint8Array>; pulled: () => number } {
    let pulled = 0
    const chunk = new Uint8Array(chunkBytes).fill(0x20)
    return {
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          if (pulled >= chunks) return controller.close()
          pulled++
          controller.enqueue(chunk)
        },
      }, { highWaterMark: 0 }),
      pulled: () => pulled,
    }
  }

  it('a declared length above 2 MB gets 413 without a single read', async () => {
    const s = server()
    const { b } = await signedIn(s)
    const source = stream(1000, 65_536)
    for (const [route, method] of [['sync', 'PUT'], ['sync/replace', 'PUT']] as const) {
      const reply = await b.call(route, undefined, { method, rawBody: source.body, headers: { 'content-length': String(MAX_BODY_BYTES + 1) } })
      expect(reply.status, route).toBe(413)
    }
    expect(source.pulled()).toBe(0)
  })

  it('a streamed body with no declared length stops being read just past 2 MB', async () => {
    const s = server()
    const { b } = await signedIn(s)
    const source = stream(1000, 65_536)
    const reply = await b.call('sync', undefined, { method: 'PUT', rawBody: source.body })
    expect(reply.status).toBe(413)
    expect(source.pulled() * 65_536).toBeLessThan(MAX_BODY_BYTES + 3 * 65_536)
    expect(source.pulled()).toBeGreaterThan(0)
  })

  it('a lying content-length cannot get past the streamed limit either', async () => {
    const s = server()
    const { b } = await signedIn(s)
    const source = stream(100, 65_536)
    const reply = await b.call('sync', undefined, { method: 'PUT', rawBody: source.body, headers: { 'content-length': '10' } })
    expect(reply.status).toBe(413)
  })

  it('a body of exactly 2 MB of padding is read and then rejected as invalid, not as too large', async () => {
    const s = server()
    const { b } = await signedIn(s)
    const reply = await b.call('sync', undefined, { method: 'PUT', rawBody: ' '.repeat(MAX_BODY_BYTES) })
    expect(reply.status).toBe(400)
  })
})

describe('S0 nothing is compressed or sealed before the input is valid', () => {
  async function rejected(label: string, send: (b: Browser, key: string) => Promise<{ status: number }>, status = 400): Promise<void> {
    const s = server()
    const { b, key } = await signedIn(s)
    const randomBefore = s.deps.random
    let draws = 0
    s.deps.random = (bytes) => { draws++; return randomBefore(bytes) }
    const reply = await send(b, key)
    expect(reply.status, label).toBe(status)
    expect(draws, `${label}: nothing was sealed`).toBe(0)
    expect(s.rows('plans'), label).toEqual([])
  }

  const valid = smallPlan()
  const cases: [string, (key: string) => unknown][] = [
    ['not an object', () => 'plan'],
    ['an array', () => []],
    ['no document', (key) => ({ accountKey: key, baseRevision: 0, epoch: 0 })],
    ['an extra envelope key', (key) => ({ ...body(key, valid), extra: 1 })],
    ['a string baseRevision', (key) => ({ ...body(key, valid), baseRevision: '0' })],
    ['a negative epoch', (key) => ({ ...body(key, valid), epoch: -1 })],
    ['a fractional revision', (key) => ({ ...body(key, valid), baseRevision: 1.5 })],
    ['a null document', (key) => body(key, null)],
    ['a wrong schema version', (key) => body(key, { ...valid, schemaVersion: 2 })],
    ['a missing field', (key) => body(key, { ...valid, tasks: undefined })],
    ['too many blocks', (key) => body(key, { ...valid, blocks: Array.from({ length: 1001 }, (_, i) => ({ id: `b${i}`, categoryId: 'c-work', title: 't', days: [0], start: 1, end: 2 })) })],
    ['a text above its limit', (key) => body(key, { ...valid, categories: [{ ...valid.categories[0], name: 'x'.repeat(61) }] })],
    ['a bad date', (key) => body(key, { ...valid, updatedAt: 'yesterday' })],
    ['a wrong type inside the settings', (key) => body(key, { ...valid, settings: { ...valid.settings, theme: 'neon' } })],
  ]
  it.each(cases)('PUT /api/sync: %s → 400', async (label, make) => {
    await rejected(label, (b, key) => b.putPlan(make(key)))
  })

  it.each(cases.filter(([label]) => !/Revision|epoch|extra envelope/.test(label)))('PUT /api/sync/replace: %s → 400', async (label, make) => {
    await rejected(label, (b, key) => b.replacePlan(make(key)))
  })

  it('a body that is not JSON, not UTF-8, or encoded → 400', async () => {
    await rejected('text', (b) => b.call('sync', undefined, { method: 'PUT', rawBody: 'not json' }))
    await rejected('bytes', (b) => b.call('sync', undefined, { method: 'PUT', rawBody: new ReadableStream({ start(c) { c.enqueue(new Uint8Array([0xff, 0xfe, 0x7b])); c.close() } }) }))
    await rejected('gzip', (b, key) => b.call('sync', body(key, smallPlan()), { method: 'PUT', headers: { 'content-encoding': 'gzip' } }))
  })

  it('unknown fields of the document are dropped, never stored', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    expect((await b.putPlan(body(key, { ...smallPlan(), evil: 'x'.repeat(1000), settings: { ...smallPlan().settings, extra: 1 } }))).status).toBe(200)
    expect((await b.getPlan(key)).body!.document).toEqual(smallPlan())
  })

  it('a valid small plan is sealed (the control for the cases above)', async () => {
    const s = server()
    const { b, key } = await signedIn(s)
    const randomBefore = s.deps.random
    let draws = 0
    s.deps.random = (bytes) => { draws++; return randomBefore(bytes) }
    expect((await b.putPlan(body(key, smallPlan()))).status).toBe(200)
    expect(draws).toBeGreaterThan(0)
  })
})
