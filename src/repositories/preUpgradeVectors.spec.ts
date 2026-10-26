// Pre-upgrade copy vectors (tasks design rev 6 §2.2, addendum 6.1 F7). Each vector is a version-1 database seeded
// through the real pre-fence stores; the fence takes the complete copy and its `portableHash`. The expected hashes were
// recorded by running d325df4's capture path (`NEXT168_RECORD_VECTORS=1` rewrites them); every later build must keep
// them, whatever its current document schema is.
// - portable vectors: valid documents. The hash equals the recorded value and the copy downloads as a bundle that imports.
// - raw-recovery vectors: absent, non-string, corrupt, unsupported and duplicate-source-id documents. The originals are
//   kept byte for byte, `portableHash` is null and no portable bundle is offered.
import { readFileSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { IDBFactory } from 'fake-indexeddb'
import { parseExportBundle } from '@/core/exportBundle'
import { preUpgradeFiles } from '@/features/settings/data/preUpgradeCopy'
import { dumpDatabases, preFenceBuild } from '@/test/storageFence'
import { createStorageFence, PLANNER_DATABASE, PRE_UPGRADE_COPY_KEY, type PreUpgradeCopy } from './storageVersion'
import { fixedNow, mutexRunner } from './testSupport'

interface Vector {
  name: string
  kind: 'portable' | 'raw'
  // The stored planner record exactly as version 1 held it (absent when undefined).
  document?: unknown
  calendars: [id: string, text: string][]
  portableHash: string | null
}

const FILE = 'src/repositories/__fixtures__/preUpgradeVectors.json'
const RECORD = process.env.NEXT168_RECORD_VECTORS === '1'

const ics = (title: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//weeklid//vectors//EN\r\nBEGIN:VEVENT\r\nUID:${title.replace(/\W/g, '')}@vectors\r\nDTSTART:20261019T090000Z\r\nDTEND:20261019T100000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR`
const source = (id: string, name: string) => ({ id, name, kind: 'file', colorKey: 'blue' })

function v2Document(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schemaVersion: 2, workspaceId: 'ws-vectors', revision: 0, updatedAt: '2026-10-20T08:00:00.000Z',
    settings: { locale: 'es', weekStartsOn: 1, timeZone: 'America/Bogota', onboardingDone: true, theme: 'system' },
    categories: [{ id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } }],
    blocks: [{ id: 'b-work', categoryId: 'c-work', title: 'Trabajo', days: [1, 2, 3, 4, 5], start: 540, end: 1020 }],
    tasks: [{ id: 't-1', title: 'Informe trimestral', categoryId: 'c-work', durationMin: 120, dueDate: '2026-10-30', priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
    checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
    ...overrides,
  }
}
const json = (value: unknown) => JSON.stringify(value)
const three = [source('cal-a', 'Equipo'), source('cal-b', 'Festivos'), source('cal-c', 'Café 日本')]

// The inputs of every vector; the expected hashes come from the recorded file.
const INPUTS: Omit<Vector, 'portableHash'>[] = [
  { name: 'no sources', kind: 'portable', document: json(v2Document()), calendars: [] },
  { name: 'one source, non-zero revision', kind: 'portable', document: json(v2Document({ revision: 7, calendarSources: [source('cal-a', 'Equipo')] })), calendars: [['cal-a', ics('Equipo')]] },
  {
    name: 'three sources with non-ASCII text and an orphan text', kind: 'portable', document: json(v2Document({ revision: 3, calendarSources: three })),
    calendars: [['cal-a', ics('Equipo')], ['cal-b', ics('Festivos')], ['cal-c', ics('Reunión café ☕ 日本語 ñandú')], ['cal-orphan', ics('Huérfano')]],
  },
  {
    name: 'the same three sources in another order', kind: 'portable', document: json(v2Document({ revision: 3, calendarSources: [three[2], three[0], three[1]] })),
    calendars: [['cal-a', ics('Equipo')], ['cal-b', ics('Festivos')], ['cal-c', ics('Reunión café ☕ 日本語 ñandú')], ['cal-orphan', ics('Huérfano')]],
  },
  { name: 'a missing source text', kind: 'portable', document: json(v2Document({ calendarSources: [source('cal-a', 'Equipo'), source('cal-gone', 'Perdido')] })), calendars: [['cal-a', ics('Equipo')]] },
  { name: 'a source id named __proto__', kind: 'portable', document: json(v2Document({ calendarSources: [source('__proto__', 'Proto')] })), calendars: [['__proto__', ics('Proto')]] },
  { name: 'absent document', kind: 'raw', calendars: [['cal-a', ics('Equipo')]] },
  { name: 'non-string document', kind: 'raw', document: v2Document(), calendars: [] },
  { name: 'corrupt document', kind: 'raw', document: '{"schemaVersion":2,"workspaceId":', calendars: [] },
  { name: 'unsupported document', kind: 'raw', document: json(v2Document({ schemaVersion: 9 })), calendars: [] },
  { name: 'duplicate source id', kind: 'raw', document: json(v2Document({ calendarSources: [source('cal-a', 'Uno'), source('cal-a', 'Dos')] })), calendars: [['cal-a', ics('Equipo')]] },
]

function recorded(): Vector[] {
  return JSON.parse(readFileSync(FILE, 'utf8')) as Vector[]
}

// The copy the current fence takes from a version-1 database seeded with `input`.
async function captured(input: Omit<Vector, 'portableHash'>): Promise<PreUpgradeCopy> {
  const factory = new IDBFactory()
  const lock = mutexRunner()
  const old = await preFenceBuild(factory, lock)
  for (const [id, text] of input.calendars) await old.texts.put(id, text)
  // The backup keeps the copy non-empty when the document itself is absent.
  await old.store.write({ ...(input.document === undefined ? {} : { document: input.document as string }), backup: json(v2Document({ revision: 1 })) })
  await createStorageFence(factory, { lock, now: fixedNow }).ready()
  const dump = JSON.parse(await dumpDatabases(factory, [PLANNER_DATABASE]))
  const entry = (dump[PLANNER_DATABASE].stores.snapshots as [string, PreUpgradeCopy][]).find(([key]) => key === PRE_UPGRADE_COPY_KEY)
  if (!entry) throw new Error(`no copy for ${input.name}`)
  return entry[1]
}

describe('pre-upgrade copy vectors', () => {
  it.runIf(RECORD)('records the vectors from the current capture path', async () => {
    const vectors: Vector[] = []
    for (const input of INPUTS) vectors.push({ ...input, portableHash: (await captured(input)).portableHash })
    writeFileSync(FILE, `${JSON.stringify(vectors, null, 2)}\n`)
  })

  it('the inputs are the recorded ones', () => {
    expect(recorded().map(({ name, kind, document, calendars }) => ({ name, kind, document, calendars }))).toEqual(INPUTS.map((input) => JSON.parse(JSON.stringify(input))))
  })

  for (const vector of RECORD ? [] : recorded()) {
    it(`${vector.kind} vector: ${vector.name}`, async () => {
      const copy = await captured(vector)
      expect(copy.portableHash).toBe(vector.portableHash)
      expect(copy.raw.document).toEqual(vector.document)
      const files = await preUpgradeFiles(copy)
      // The raw recovery file always keeps the stored records as they were.
      expect((JSON.parse(files.raw.json) as PreUpgradeCopy).raw.document).toEqual(vector.document)
      if (vector.kind === 'portable') {
        expect(vector.portableHash).toMatch(/^[0-9a-f]{64}$/)
        expect(files.bundle).toBeDefined()
        expect(parseExportBundle(files.bundle!.json).kind).toBe('ok')
      } else {
        expect(vector.portableHash).toBeNull()
        expect(files.bundle).toBeUndefined()
      }
    })
  }
})
