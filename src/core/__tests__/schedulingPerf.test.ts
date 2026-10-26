// @vitest-environment node
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { setImmediate } from 'node:timers/promises'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { BusyInterval, PlannerDocument, Task, TaskPlacement, TimeBlock } from '../model'
import { fitTasks, type StableScheduleInput } from '../scheduling'
import { datedOccurrences, localDateOf } from '../time'
import { warningFixes } from '@/features/tasks/warningFixes'
import { PERF_NOW, PERF_TIME_ZONE, perfBusy, perfCase, perfCases, perfPlanner, perfTasks, typicalBlocks, type PerfCase } from '../__fixtures__/schedulingPerf'
import { referenceFitTasks } from './referenceScheduling'

// P0 spec §4: original placements remain recorded (A1); the explicit short-final-chunk correction is checked separately.
// Zoned conversions (A2, A3), growth per task (A4), and wall time (A5 with `npm run perf`, A6 here) stay within budget.
// Operation counts are the deterministic gate; wall
// times are warm medians, so a loaded machine slows them without failing them by chance.

const GOLDEN_URL = new URL('../__fixtures__/schedulingGolden.json', import.meta.url)
const RECORD_GOLDEN = process.env.NEXT168_RECORD_GOLDEN === '1'
const REFERENCE_MACHINE = process.env.NEXT168_PERF === 'reference'
const SLOW = 600_000

const sha256 = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
// Inputs are hashed in the shape the goldens were recorded in (schema v2): the v3 bookkeeping fields
// (schemaVersion, generation, appliedCaptureIds) are not read by the scheduler and are left out of the hash.
function recordedShape(document: PlannerDocument): unknown {
  const shape: Record<string, unknown> = { ...document, schemaVersion: 2 }
  delete shape.generation
  delete shape.appliedCaptureIds
  return shape
}
const serializable = (input: StableScheduleInput) => ({
  ...input,
  document: recordedShape(input.document),
  previous: input.previous ? [...input.previous.entries()] : undefined,
  pinned: input.pinned ? [...input.pinned.entries()] : undefined,
})
// P1 adds a `key` to every placement it makes (what a shown placement is reused for); the frozen oracle predates it.
function withoutKeys(placements: TaskPlacement[]): TaskPlacement[] {
  return placements.map((placement) => {
    const copy = { ...placement }
    delete copy.key
    return copy
  })
}
// P1 places an undated task of a category with no routine block in the horizon in free time (design rev 4 §2.7); the
// frozen oracle never places it. For the oracle, such a task is the same task with no category.
function asOracleInput(input: StableScheduleInput): StableScheduleInput {
  const { document, now, timeZone, days = 7 } = input
  const withBlocks = new Set(datedOccurrences(document, localDateOf(now, timeZone), days, timeZone).map((item) => item.categoryId))
  const tasks = document.tasks.map((task) => {
    if (task.categoryId === undefined || task.dueDate !== undefined || withBlocks.has(task.categoryId)) return task
    const free = { ...task }
    delete free.categoryId
    return free
  })
  return { ...input, document: { ...document, tasks } }
}
const byTask = (placements: TaskPlacement[]) => new Map(placements.map((placement) => [placement.taskId, placement]))
const inputOf = (item: PerfCase): StableScheduleInput => ({ document: item.document, busy: item.busy, now: item.now, timeZone: item.timeZone })
const minutesLater = (at: Date, minutes: number) => new Date(at.getTime() + minutes * 60_000)

// The three extra golden planners of A1, plus the two DST transitions of Europe/Berlin. Earlier placements come from
// the recorded goldens, so the new remainder rule cannot change the historical fixture inputs.
function extraCases(): { name: string; input: StableScheduleInput }[] {
  const golden = JSON.parse(readFileSync(GOLDEN_URL, 'utf8')) as Golden
  const base = perfCase('typical', 50)
  const earlier = byTask(golden.cases['typical-50']!.placements)

  // (i) Undo pins today's placements; by 10:47 the first ones have passed and are still kept until the day ends.
  const today = [...earlier.values()].filter((placement) => placement.chunks.length && placement.chunks[0]!.start < '2026-10-27T05:00:00.000Z')
  const pinned = { ...inputOf(base), now: minutesLater(PERF_NOW, 165), previous: earlier, pinned: new Map(today.slice(0, 12).map((placement) => [placement.taskId, placement])) }

  // (ii) A placement under way at 08:20 is kept; the rest keep theirs or are placed again.
  const underWay = { ...inputOf(base), now: minutesLater(PERF_NOW, 18), previous: earlier }

  // (iii) Gym tasks due Tuesday: only Monday's gym hour is before the deadline, so the rest go to free time.
  const gymTasks: Task[] = perfTasks(24).map((task, i) => ({ ...task, categoryId: i % 2 ? 'gym' : task.categoryId, dueDate: i % 2 ? '2026-10-27' : task.dueDate, durationMin: i % 2 ? 60 : task.durationMin }))
  const fallback = { document: perfPlanner(typicalBlocks, gymTasks), busy: perfBusy(40), now: PERF_NOW, timeZone: PERF_TIME_ZONE }

  // Berlin: a night routine across the autumn fold (25 Oct, 03:00 CEST -> 02:00 CET) and the spring gap (29 Mar).
  const nightBlocks: TimeBlock[] = [...typicalBlocks.filter((block) => block.id !== 'sleep'), { id: 'night', categoryId: 'sleep', title: 'Night', days: [0, 1, 2, 3, 4, 5, 6], start: 90, end: 165 }]
  const berlin = (now: Date) => ({ document: perfPlanner(nightBlocks, perfTasks(60), 'Europe/Berlin'), busy: perfBusy(20, now), now, timeZone: 'Europe/Berlin' })
  const fold = berlin(new Date('2026-10-24T22:32:00Z'))
  const foldLater = { ...fold, now: new Date('2026-10-25T01:20:00Z'), previous: byTask(golden.cases['berlin-fold']!.placements) }
  const gap = berlin(new Date('2026-03-28T23:41:00Z'))

  return [
    { name: 'extra-pinned-through-undo', input: pinned },
    { name: 'extra-previous-under-way', input: underWay },
    { name: 'extra-deadline-fallback', input: fallback },
    { name: 'berlin-fold', input: fold },
    { name: 'berlin-fold-with-previous', input: foldLater },
    { name: 'berlin-gap', input: gap },
  ]
}

const goldenCases = () => [...perfCases().map((item) => ({ name: item.name, input: inputOf(item) })), ...extraCases()]

interface Golden { fixtureSha: string; cases: Record<string, { inputSha: string; placementsSha: string; placements: TaskPlacement[] }> }

describe('A1 golden equivalence', () => {
  it('preserves the 239b9bc goldens and isolates the short-final-chunk rule change', async () => {
    const cases = goldenCases()
    const fixtureSha = sha256(cases.map(({ name, input }) => [name, serializable(input)]))
    if (RECORD_GOLDEN) {
      const golden: Golden = { fixtureSha, cases: {} }
      for (const { name, input } of cases) {
        const placements = referenceFitTasks(input, false)
        golden.cases[name] = { inputSha: sha256(serializable(input)), placementsSha: sha256(placements).slice(0, 16), placements }
      }
      writeFileSync(GOLDEN_URL, `${JSON.stringify(golden)}\n`)
    }
    const golden = JSON.parse(readFileSync(GOLDEN_URL, 'utf8')) as Golden
    expect(golden.fixtureSha, 'the fixtures changed after the golden placements were recorded').toBe(fixtureSha)
    // Exact corrected outputs, audited in ../__fixtures__/schedulingShortFinalChunks.md; no goldens re-recorded.
    const correctedHashes: Record<string, string> = {
      'typical-50': '06f2c45859b3874a8530db2627d5a29100866aebff95b3ea6f85de623fec04f7',
      'typical-200': 'ec434478c8fec8697f3e9a740dc159ce03fc8f3d0600e6d63e8cdec777470f00',
      'typical-1000': '093dcb34b691d1bf0d706574464d42b83b04ea1f902ae6b6e1de0c76a37a7a7e',
      'dense-50': '9b9a9affa212a76357ffc14fa5b6cf11860d922cbfec3d27259cb5e409f91239',
      'dense-200': 'ecf362f1d321bd1e1bb641b372cd11862a37ce387f2a32e481a8a4355b041b22',
      'dense-1000': '98f2983ee49e96e6459bb871ae1b6fa78028f20284e109cc477b6f232445a35a',
      'extra-pinned-through-undo': '9687abf5ae659dc1851410da30e19fffb8464a65be7bc03408b5737ce62beb3d',
      'extra-previous-under-way': '686975026290bb0780da69048589b2a0e96ad74a713ef43525dfe176543b0140',
      'extra-deadline-fallback': '1b2d4764e10230aa92ceffb75e27c2bd47cfe4e651c7c075952888229ea0a896',
      'berlin-fold': 'a3d0bc5c80c59fd34cae0a7030f152d68f4cf51c322b6c8a0aba4a590ca27f7b',
      'berlin-fold-with-previous': '1ad15747417268e83ff421b160f3904b55ad320cdf27a2cd875b5e7744ee6fa1',
      'berlin-gap': '61b2ae238baba0162ef12ad4e35068728f0d35c69a452ac289b625ae565bd13f',
    }
    for (const { name, input } of cases) {
      const recorded = golden.cases[name]!
      expect(sha256(serializable(input)), name).toBe(recorded.inputSha)
      expect(referenceFitTasks(input, false), `${name}: original rule`).toEqual(recorded.placements)
      // The slow oracles must let Vitest's worker RPC progress between CPU-bound runs.
      await setImmediate()
      const corrected = referenceFitTasks(input)
      expect(sha256(corrected), `${name}: only the final-chunk rule changed`).toBe(correctedHashes[name])
      expect(withoutKeys(fitTasks(input)), name).toEqual(corrected)
      await setImmediate()
    }
  }, SLOW)

  it('matches the measured placements of the P0 benchmark', () => {
    const golden = JSON.parse(readFileSync(GOLDEN_URL, 'utf8')) as Golden
    expect(['typical-50', 'typical-200', 'typical-1000', 'dense-50', 'dense-200', 'dense-1000'].map((name) => golden.cases[name]!.placementsSha))
      .toEqual(['781e7cdc3f628fc9', '9541b2fe4e5911fb', '6d9a65eda47d79b2', '4887295cd368ca28', 'd80ddc84f015ed57', 'd32a20388bc22790'])
  })

  it('agrees with the per-task reference on 200 random planners (zones, DST, overnight routines, pins)', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const input = randomPlanner(seed)
      const expected = outcome(() => referenceFitTasks(asOracleInput(input)))
      expect(outcome(() => withoutKeys(fitTasks(input))), `seed ${seed}`).toEqual(expected)
    }
  }, SLOW)
})

function outcome(run: () => TaskPlacement[]): { placements?: TaskPlacement[]; error?: string } {
  try {
    return { placements: run() }
  } catch (error) {
    return { error: (error as Error).message }
  }
}

// mulberry32: a small seeded generator, so every failure names a reproducible seed.
function generator(seed: number) {
  let state = seed >>> 0
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
  const int = (min: number, max: number) => min + Math.floor(next() * (max - min + 1))
  const pick = <T>(items: readonly T[]): T => items[int(0, items.length - 1)]!
  return { next, int, pick, chance: (p: number) => next() < p }
}

const ZONES = ['America/Bogota', 'Europe/Berlin', 'UTC', 'Asia/Kolkata', 'America/New_York'] as const
// Around the Berlin fold and gap, the New York fold, and an ordinary week.
const ANCHORS = ['2026-10-24T21:00:00Z', '2026-10-25T00:10:00Z', '2026-03-28T22:00:00Z', '2026-03-29T00:30:00Z', '2026-10-31T23:00:00Z', '2026-10-26T13:02:00Z'] as const

function randomPlanner(seed: number): StableScheduleInput {
  const random = generator(seed)
  const timeZone = random.pick(ZONES)
  const now = new Date(Date.parse(random.pick(ANCHORS)) + random.int(-600, 600) * 60_000 + random.int(0, 59) * 1000)
  const days = random.pick([7, 7, 7, 1, 3])
  const snapMinutes = random.pick([5, 5, 5, 15, 30])
  const categoryIds = ['work', 'sleep', 'gym', 'empty']
  const blocks: TimeBlock[] = Array.from({ length: random.int(0, 7) }, (_, i) => {
    const start = random.int(0, 287) * 5
    const overnight = random.chance(0.3)
    const end = overnight ? random.int(0, Math.floor(start / 5)) * 5 : Math.min(1435, start + random.int(3, 60) * 5)
    const days = [0, 1, 2, 3, 4, 5, 6].filter(() => random.chance(0.6))
    return { id: `b${i}`, categoryId: random.pick(categoryIds.slice(0, 3)), title: `Block ${i}`, days: days.length ? days : [random.int(0, 6)], start, end: end === start ? (start + 60) % 1440 : end }
  }).filter((block) => block.end !== block.start)
  const today = new Date(now.getTime()).toISOString().slice(0, 10)
  const dateFrom = (offset: number) => new Date(Date.parse(`${today}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
  const tasks: Task[] = Array.from({ length: random.int(0, 40) }, (_, i) => ({
    id: `t${i}`,
    title: `Task ${i}`,
    durationMin: random.pick([15, 20, 30, 45, 60, 90, 120, 180, 25, 35]),
    priority: random.pick([1, 2, 3] as const),
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, random.int(0, 3000))).toISOString(),
    ...(random.chance(0.7) ? { categoryId: random.pick(categoryIds) } : {}),
    ...(random.chance(0.45) ? { dueDate: dateFrom(random.int(-2, 8)) } : {}),
    ...(random.chance(0.1) ? { doneAt: now.toISOString() } : {}),
  }))
  const interval = () => {
    const start = now.getTime() + random.int(-120, 7 * 24 * 60) * 60_000 + random.int(0, 59) * 1000
    return { start: new Date(start).toISOString(), end: new Date(start + random.int(1, 240) * 60_000 + random.int(0, 59) * 1000).toISOString() }
  }
  const busy: BusyInterval[] = Array.from({ length: random.int(0, 12) }, interval)
  // Now and then a zero-length interval on the grid, which both implementations must reject the same way.
  if (random.chance(0.04)) {
    const at = new Date(Math.ceil(now.getTime() / 3_600_000) * 3_600_000).toISOString()
    busy.push({ start: at, end: at })
  }
  const events = Array.from({ length: random.int(0, 4) }, (_, i) => ({ id: `e${i}`, title: `Event ${i}`, allDay: false, attendees: [], ...interval() }))
  const document: PlannerDocument = { ...perfPlanner(blocks, tasks, timeZone), events }
  document.categories.push({ id: 'empty', name: 'No blocks', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 } })
  const input: StableScheduleInput = { document, busy, now, timeZone, days, snapMinutes }
  if (random.chance(0.5)) {
    // Placements shown a while ago, some since edited or dropped; Undo pins a few of them.
    const before = { ...input, now: new Date(now.getTime() - random.int(0, 240) * 60_000) }
    const shown = outcome(() => referenceFitTasks(before)).placements ?? []
    const previous = new Map(shown.filter(() => random.chance(0.85)).map((placement) => [placement.taskId, placement]))
    for (const task of document.tasks) if (random.chance(0.1)) task.durationMin = random.pick([15, 30, 60])
    input.previous = previous
    if (random.chance(0.5)) input.pinned = new Map([...previous].filter(() => random.chance(0.3)))
  }
  return input
}

// --- Zoned conversions (A2, A3) -------------------------------------------------------------------------------

describe('zoned conversions', () => {
  const counters = { constructions: 0, formatToParts: 0 }
  const RealDateTimeFormat = Intl.DateTimeFormat
  const realFormatToParts = RealDateTimeFormat.prototype.formatToParts
  beforeAll(() => {
    RealDateTimeFormat.prototype.formatToParts = function (this: Intl.DateTimeFormat, ...args: Parameters<Intl.DateTimeFormat['formatToParts']>) {
      counters.formatToParts++
      return realFormatToParts.apply(this, args)
    }
    Intl.DateTimeFormat = new Proxy(RealDateTimeFormat, {
      construct(target, args) {
        counters.constructions++
        return Reflect.construct(target, args) as object
      },
    })
  })
  afterAll(() => {
    RealDateTimeFormat.prototype.formatToParts = realFormatToParts
    Intl.DateTimeFormat = RealDateTimeFormat
  })
  const counted = (run: () => void) => {
    counters.constructions = 0
    counters.formatToParts = 0
    run()
    return { ...counters }
  }

  it('A3: a fresh module builds at most 2 formatters for one typical-1,000 fit', async () => {
    vi.resetModules()
    const fresh = await import('../scheduling')
    const ops = counted(() => fresh.fitTasks(inputOf(perfCase('typical', 1000))))
    expect(ops.constructions).toBeLessThanOrEqual(2)
  }, SLOW)

  it.each(['typical', 'dense'] as const)('A2: one %s-1,000 fit makes at most 5,000 zoned conversions', (scenario) => {
    const ops = counted(() => fitTasks(inputOf(perfCase(scenario, 1000))))
    expect(ops.formatToParts).toBeLessThanOrEqual(5000)
  }, SLOW)
})

// --- Wall time (A4, A5, A6) -----------------------------------------------------------------------------------

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!
function timed<T>(run: () => T): { ms: number; value: T } {
  const start = performance.now()
  const value = run()
  return { ms: performance.now() - start, value }
}
// Warm median of `runs` after one warm-up. A run over ten budgets ends the measurement at once and is reported as is.
function warmMedian(run: () => unknown, runs: number, budget = Infinity): { ms: number; label: string } {
  const warmUp = timed(run).ms
  if (warmUp > budget * 10) return { ms: warmUp, label: 'first run, over 10x the budget' }
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const { ms } = timed(run)
    if (ms > budget * 10) return { ms, label: 'a warm run, over 10x the budget' }
    times.push(ms)
  }
  return { ms: median(times), label: `warm median of ${runs}` }
}

describe('wall time', () => {
  it('A4: work per task does not grow with earlier placements (typical 1,000 / 200 ≤ 8)', () => {
    const small = inputOf(perfCase('typical', 200))
    const large = inputOf(perfCase('typical', 1000))
    // Interleaved, so a burst of load on the machine slows both sizes alike.
    fitTasks(small)
    fitTasks(large)
    const smallRuns: number[] = []
    const largeRuns: number[] = []
    for (let i = 0; i < 15; i++) {
      smallRuns.push(timed(() => fitTasks(small)).ms)
      largeRuns.push(timed(() => fitTasks(large)).ms)
    }
    const smallMs = median(smallRuns)
    const largeMs = median(largeRuns)
    console.info(`[perf] typical-200 ${smallMs.toFixed(1)} ms, typical-1000 ${largeMs.toFixed(1)} ms, ratio ${(largeMs / smallMs).toFixed(2)} (budget 8)`)
    expect(largeMs / smallMs, `typical-200 ${smallMs.toFixed(1)} ms, typical-1000 ${largeMs.toFixed(1)} ms`).toBeLessThanOrEqual(8)
  }, SLOW)

  // CI runs the looser A6 budget; `npm run perf` runs A5 on the reference machine (Apple M2) and prints every case.
  const fitBudget = REFERENCE_MACHINE ? 100 : 300
  it.each(['typical', 'dense'] as const)(`A${REFERENCE_MACHINE ? 5 : 6}: one %s-1,000 fit takes at most ${fitBudget} ms (warm median of 5)`, (scenario) => {
    const input = inputOf(perfCase(scenario, 1000))
    const { ms, label } = warmMedian(() => fitTasks(input), 5, fitBudget)
    console.info(`[perf] ${scenario}-1000 fit ${ms.toFixed(1)} ms (${label}; budget ${fitBudget} ms)`)
    expect(ms).toBeLessThanOrEqual(fitBudget)
  }, SLOW)

  it.runIf(REFERENCE_MACHINE)('A5: steady re-fits ≤ 100 ms and one warning\'s fixes ≤ 50 ms at 1,000 tasks; every case recorded', () => {
    const rows: Record<string, unknown>[] = []
    for (const item of perfCases()) {
      const input = inputOf(item)
      const cold = timed(() => fitTasks(input))
      const warm = warmMedian(() => fitTasks(input), 5).ms
      const previous = byTask(cold.value)
      const steady = warmMedian(() => fitTasks({ ...input, previous }), 5).ms
      const warnings = cold.value.filter((placement) => placement.overflowMinutes > 0 || placement.late)
      const sample = [0, Math.floor(warnings.length / 2), warnings.length - 1].filter((index, position, all) => index >= 0 && all.indexOf(index) === position)
      const context = { document: item.document, busy: item.busy, now: item.now }
      const fixes = sample.map((index) => {
        const placement = warnings[index]!
        const task = item.document.tasks.find((candidate) => candidate.id === placement.taskId)!
        return timed(() => warningFixes(context, task, placement)).ms
      })
      rows.push({ case: item.name, coldMs: Math.round(cold.ms), warmMedianMs: +warm.toFixed(1), steadyMs: +steady.toFixed(1), warnings: warnings.length, fixMedianMs: fixes.length ? +median(fixes).toFixed(1) : 0 })
    }
    console.info(`[perf] ${new Date().toISOString()}\n${rows.map((row) => JSON.stringify(row)).join('\n')}`)
    for (const row of rows.filter((candidate) => String(candidate.case).endsWith('-1000'))) {
      expect(row.steadyMs as number, `${row.case} steady`).toBeLessThanOrEqual(100)
      expect(row.fixMedianMs as number, `${row.case} fixes`).toBeLessThanOrEqual(50)
    }
  }, SLOW)
})
