import { describe, expect, it } from 'vitest'
import { createEmptyDocument, nextRevision, parseDocument } from '../documents'
import { migrateToCurrent } from '../migrations'
import { plannerDocumentSchema } from '../model'
import { document, env, sampleV1 } from './fixtures'

describe('documents and migration', () => {
  it('creates a valid empty document with injected settings and clock', () => {
    const doc = createEmptyDocument(env)
    expect(plannerDocumentSchema.parse(doc)).toEqual(doc)
    expect(doc).toMatchObject({ workspaceId: 'workspace', revision: 0, updatedAt: env.now.toISOString(), blocks: [], settings: { timeZone: env.timeZone, locale: 'en' } })
    expect(createEmptyDocument({ ...env, idGen: undefined }).workspaceId).not.toBe(doc.workspaceId)
    expect(nextRevision(doc, { now: () => env.now })).toMatchObject({ revision: 1 })
    expect(doc.revision).toBe(0)
  })
  it('migrates every sample category field and round-trips', () => {
    const result = migrateToCurrent(sampleV1, env)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') throw Error('migration')
    expect(result.migratedFrom).toBe(1)
    sampleV1.categories.forEach((old, index) => expect(result.document.categories[index]).toMatchObject({ id: old.id, name: old.name, icon: old.icon, customColor: old.color, goal: { type: 'max', hoursPerWeek: old.weeklyHourLimit } }))
    expect(parseDocument(JSON.stringify(result.document))).toEqual({ kind: 'ok', document: result.document })
    expect(result.document.settings.onboardingDone).toBe(false)
  })
  it('preserves block fields, deduplicates days, derives duration, and sets onboarding', () => {
    const legacy = { categories: sampleV1.categories, timeBlocks: [{ id: 'night', categoryId: 'sleep', title: 'Sleep', description: 'Keep this', dayOfWeek: 6, repeatDays: [6, 0, 0, 2], startTime: '22:00', endTime: '06:00', durationMinutes: 999 }] }
    const result = migrateToCurrent(JSON.stringify(legacy), env)
    if (result.kind !== 'ok') throw Error('migration')
    expect(result.document.blocks).toEqual([{ id: 'night', categoryId: 'sleep', title: 'Sleep', notes: 'Keep this', days: [6, 0, 2], start: 1320, end: 360 }])
    expect(result.document.settings.onboardingDone).toBe(true)
    expect(migrateToCurrent({ categories: [], timeBlocks: [] }, { ...env, tutorialCompleted: true })).toMatchObject({ kind: 'ok', document: { settings: { onboardingDone: true } } })
  })
  it('selects nearest palette color and retains exact hex casing', () => {
    const result = migrateToCurrent({ categories: [{ id: 'c', name: 'C', color: '#007AFF', weeklyHourLimit: 0 }], timeBlocks: [] }, env)
    expect(result).toMatchObject({ kind: 'ok', document: { categories: [{ colorKey: 'blue', customColor: '#007AFF' }] } })
  })
  it.each(['{bad', 'null', '{}', '[]', '"text"', '{"categories":[],"timeBlocks":[{}]}'])('never accepts corrupt input %s', (raw) => {
    expect(parseDocument(raw).kind).not.toBe('ok')
    expect(migrateToCurrent(raw, env).kind).not.toBe('ok')
  })
  it('distinguishes empty, unsupported and current data', () => {
    expect(parseDocument(null)).toEqual({ kind: 'empty' })
    expect(parseDocument('')).toMatchObject({ kind: 'corrupt' })
    expect(parseDocument('{"schemaVersion":99}')).toEqual({ kind: 'unsupported', schemaVersion: 99 })
    expect(migrateToCurrent({ schemaVersion: 99 }, env)).toMatchObject({ kind: 'unsupported' })
    expect(migrateToCurrent(document(), env)).toEqual({ kind: 'ok', document: document() })
  })
  it('migrates free-text v1 colors instead of rejecting the whole document', () => {
    const categories = [
      { ...sampleV1.categories[0]!, id: 'short', color: '#abc' },
      { ...sampleV1.categories[0]!, id: 'named', color: 'red' },
    ]
    const result = migrateToCurrent({ categories, timeBlocks: [] }, env)
    expect(result.kind).toBe('ok')
    if (result.kind !== 'ok') return
    expect(result.document.categories[0]).toMatchObject({ customColor: '#aabbcc' })
    expect(result.document.categories[1]).toMatchObject({ colorKey: 'gray' })
    expect(result.document.categories[1]!.customColor).toBeUndefined()
  })

  it('migrates the longest v1-valid block title without truncation', () => {
    const legacy = { categories: sampleV1.categories, timeBlocks: [{ id: 'long-title', categoryId: 'work', title: 'x'.repeat(100), dayOfWeek: 1, startTime: '09:00', endTime: '10:00', durationMinutes: 60 }] }
    const result = migrateToCurrent(JSON.stringify(legacy), env)
    expect(result.kind).toBe('ok')
    if (result.kind === 'ok') expect(result.document.blocks[0]!.title).toHaveLength(100)
  })

  it('retains over-limit legacy data for recovery rather than truncating it', () => {
    const legacy = { categories: sampleV1.categories, timeBlocks: [{ id: 'too-long', categoryId: 'work', title: 'x'.repeat(121), dayOfWeek: 1, startTime: '09:00', endTime: '10:00', durationMinutes: 60 }] }
    const raw = JSON.stringify(legacy)
    expect(migrateToCurrent(raw, env)).toMatchObject({ kind: 'corrupt', raw })
  })
  it('rejects invalid legacy times rather than coercing them', () => {
    expect(migrateToCurrent({ categories: [], timeBlocks: [{ id: 'x', categoryId: 'x', title: 'X', dayOfWeek: 1, startTime: '25:00', endTime: '06:00', durationMinutes: 1 }] }, env)).toMatchObject({ kind: 'corrupt' })
  })
  it('rejects duplicate ids, dangling references, dates, actual identities and invalid zones', () => {
    const doc = document()
    const parse = () => parseDocument(JSON.stringify(doc))
    doc.categories.push({ ...doc.categories[0]! })
    expect(parse()).toMatchObject({ kind: 'corrupt' })
    doc.categories.pop()
    doc.blocks.push({ id: 'x', categoryId: 'missing', title: 'X', days: [0], start: 0, end: 60 })
    expect(parse()).toMatchObject({ kind: 'corrupt' })
    doc.blocks = []
    doc.checkIns = [{ date: '2026-10-24' }, { date: '2026-10-24' }]
    expect(parse()).toMatchObject({ kind: 'corrupt' })
    doc.checkIns = []
    const actual = { date: '2026-10-24', blockId: 'deleted', categoryId: 'deleted', plannedStartAt: '2026-10-24T00:00:00Z', plannedEndAt: '2026-10-24T01:00:00Z', plannedMinutes: 60, status: 'done' as const }
    doc.actuals = [actual]
    expect(parse()).toMatchObject({ kind: 'ok' })
    doc.actuals.push({ ...actual, plannedStartAt: '2026-10-24T01:00:00+01:00', plannedEndAt: '2026-10-24T02:00:00+01:00' })
    expect(parse()).toMatchObject({ kind: 'corrupt' })
    doc.actuals = []
    doc.settings.timeZone = 'Invalid/Zone'
    expect(parse()).toMatchObject({ kind: 'corrupt' })
  })
})
