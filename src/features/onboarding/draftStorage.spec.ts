import { describe, expect, it } from 'vitest'
import {
  bindingFor, clearDismissed, clearDraft, draftOf, idsMatchBaseline, isDismissed, loadDraft, markDismissed, parseDraft, parseSetupState,
  sameBinding, saveDraft, tabNonce,
} from './draftStorage'
import { planSetupCommit } from './setupCommit'
import { isKnownScreen, sequence } from './setupFlow'
import { createState, emptyState, ensureCategory, MAX_PICKS, pick, statusOf, suggestRanges, type SetupState } from './setupModel'
import { block, category, documentWith, env } from './setupFixtures'
import legacyDrafts from './__fixtures__/legacyDraftsV2.json'

function memory(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
    removeItem: (key: string) => { items.delete(key) },
  }
}
const KEY = 'next168-setup-draft'
const stored = { kind: 'stored', workspaceId: 'ws', fingerprint: 'abc' } as const

function sampleState(): SetupState {
  const state = emptyState()
  state.answers.sleep = 'yes'
  suggestRanges(state, ensureCategory(state, 'sleep', 'sleep', 'Sleep'))
  return state
}

describe('what a saved draft accepts (A2)', () => {
  const draft = () => JSON.parse(JSON.stringify(draftOf(sampleState(), stored, true)))
  const accepted = (value: unknown) => parseSetupState(value) !== null

  it('accepts temporarily invalid input: no days, equal times, an empty name', () => {
    const value = draft()
    value.categories[0].ranges[0].days = []
    value.categories[0].ranges[0].end = value.categories[0].ranges[0].start
    value.categories[0].name = ''
    expect(accepted(value)).toBe(true)
  })

  it.each([
    ['a minute below 0', (value: ReturnType<typeof draft>) => { value.categories[0].ranges[0].start = -1 }],
    ['a minute of 1440', (value: ReturnType<typeof draft>) => { value.categories[0].ranges[0].end = 1440 }],
    ['a fractional minute', (value: ReturnType<typeof draft>) => { value.categories[0].ranges[0].start = 10.5 }],
    ['a duplicate day', (value: ReturnType<typeof draft>) => { value.categories[0].ranges[0].days = [1, 1] }],
    ['a day of 7', (value: ReturnType<typeof draft>) => { value.categories[0].ranges[0].days = [7] }],
    ['an unknown screen', (value: ReturnType<typeof draft>) => { value.screen = 'nowhere' }],
    ['an extra screen without its category', (value: ReturnType<typeof draft>) => { value.screen = 'extra:ghost' }],
    ['a name of 61 characters', (value: ReturnType<typeof draft>) => { value.categories[0].name = 'x'.repeat(61) }],
    ['an unknown answer', (value: ReturnType<typeof draft>) => { value.answers.exercise = 'maybe' }],
    ['a pick that is not a category', (value: ReturnType<typeof draft>) => { value.answers.more = ['ghost'] }],
    ['the same pick twice', (value: ReturnType<typeof draft>) => { value.answers.more = ['sleep', 'sleep'] }],
    ['a stored category as a pick', (value: ReturnType<typeof draft>) => { value.categories[0].categoryId = 'c-1'; value.answers.more = ['sleep'] }],
    ['no "moreDone"', (value: ReturnType<typeof draft>) => { delete value.answers.moreDone }],
    ['a skipped first round that is done', (value: ReturnType<typeof draft>) => { value.answers.moreDone = true }],
    ['a round with no pick before it', (value: ReturnType<typeof draft>) => { value.screen = 'more:1' }],
    ['a typed name of 61 characters', (value: ReturnType<typeof draft>) => { value.pending = { name: 'x'.repeat(61) } }],
    ['a duplicate category key', (value: ReturnType<typeof draft>) => { value.categories.push(structuredClone(value.categories[0])) }],
    ['an unknown topic', (value: ReturnType<typeof draft>) => { value.categories[0].topic = 'gardening' }],
  ])('rejects %s', (_name, damage) => {
    const value = draft()
    damage(value)
    expect(accepted(value)).toBe(false)
  })

  it('accepts a name of exactly 60 characters', () => {
    const value = draft()
    value.categories[0].name = 'x'.repeat(60)
    expect(accepted(value)).toBe(true)
  })
})

describe('keeping and dropping the draft', () => {
  it('keeps the rounds and a name typed but not added (S1-10, N3)', () => {
    const storage = memory()
    const state = sampleState()
    pick(state, 0, 'family', env)
    pick(state, 1, 'friends', env)
    state.screen = 'more:2'
    state.pending = { name: 'Guitar' }
    saveDraft(draftOf(state, stored, true), storage)
    const loaded = loadDraft(storage)!
    expect(loaded).toMatchObject({ version: 3, screen: 'more:2', pending: { name: 'Guitar' }, answers: { more: ['family', 'friends'], moreDone: false } })
  })

  it('comes back as it was saved', () => {
    const storage = memory()
    const state = sampleState()
    state.screen = 'workStudy'
    expect(saveDraft(draftOf(state, stored, true), storage)).toBe(true)
    const loaded = loadDraft(storage)!
    expect(loaded).toMatchObject({ screen: 'workStudy', open: true, binding: stored })
    expect(loaded.categories).toEqual(state.categories)
  })

  it('is removed, with the old legacy draft, when it is damaged', () => {
    const storage = memory({ [KEY]: '{not json', 'next168-onboarding-draft': '{}' })
    expect(loadDraft(storage)).toBeNull()
    expect(storage.items.has('next168-onboarding-draft')).toBe(false)
    expect(storage.items.get(KEY)).not.toBe('{not json')
  })

  it('is invalidated before it is removed: a removal that throws leaves a tombstone, never the old draft (A26)', () => {
    const storage = memory()
    saveDraft(draftOf(sampleState(), stored, true), storage)
    const stubborn = { ...storage, removeItem: () => { throw new Error('blocked') } }
    clearDraft(stubborn)
    expect(storage.items.get(KEY)).toContain('submitted')
    expect(loadDraft(stubborn)).toBeNull()
    expect(parseDraft(storage.items.get(KEY)!)).toBe('submitted')
  })

  it('reports that the browser would not keep it, and never throws', () => {
    const failing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('quota') }, removeItem: () => { throw new Error('blocked') } }
    expect(saveDraft(draftOf(sampleState(), stored, true), failing)).toBe(false)
    expect(loadDraft(failing)).toBeNull()
    expect(() => clearDraft(failing)).not.toThrow()
    expect(tabNonce(failing)).toBe('no-storage')
  })
})

describe('what a draft is bound to (A5)', () => {
  const document = documentWith([category('c1', 'Work', { icon: '💼' })], [block('b1', 'c1', [1], 540, 1020)])

  it('matches the exact stored content only: another fingerprint, workspace or an unsaved binding never match', () => {
    expect(sameBinding(stored, { ...stored })).toBe(true)
    expect(sameBinding(stored, { ...stored, fingerprint: 'other' })).toBe(false)
    expect(sameBinding(stored, { ...stored, workspaceId: 'other' })).toBe(false)
    expect(sameBinding(stored, { kind: 'unsaved', tabNonce: 'n' })).toBe(false)
    expect(sameBinding({ kind: 'unsaved', tabNonce: 'n' }, { kind: 'unsaved', tabNonce: 'n' })).toBe(true)
    expect(sameBinding({ kind: 'unsaved', tabNonce: 'n' }, { kind: 'unsaved', tabNonce: 'm' })).toBe(false)
  })

  it('binds proven-empty storage to this tab and stored content to its fingerprint', () => {
    const storage = memory()
    expect(bindingFor(false, document, 'ignored', storage)).toEqual({ kind: 'unsaved', tabNonce: tabNonce(storage) })
    expect(bindingFor(true, document, 'fp', storage)).toEqual({ kind: 'stored', workspaceId: 'workspace-1', fingerprint: 'fp' })
  })

  it('applies a draft only when every stored id exists in the baseline under the same owner', () => {
    const state = createState(document, env)
    expect(idsMatchBaseline(state, document, true)).toBe(true)
    const foreignBlock = structuredClone(state)
    foreignBlock.categories[0]!.ranges[0]!.blockId = 'gone'
    expect(idsMatchBaseline(foreignBlock, document, true)).toBe(false)
    const foreignCategory = structuredClone(state)
    foreignCategory.categories[0]!.categoryId = 'gone'
    expect(idsMatchBaseline(foreignCategory, document, true)).toBe(false)
    const movedBlock = documentWith([category('c1', 'Work'), category('c2', 'Other')], [block('b1', 'c2', [1], 540, 1020)])
    expect(idsMatchBaseline(state, movedBlock, true)).toBe(false)
  })

  it('lets a draft from proven-empty storage hold no ids at all', () => {
    expect(idsMatchBaseline(sampleState(), null, false)).toBe(true)
    expect(idsMatchBaseline(createState(document, env), document, false)).toBe(false)
  })
})

describe('the dismissal flag', () => {
  it('belongs to one workspace key and is cleared on demand', () => {
    const storage = memory()
    expect(isDismissed('ws', storage)).toBe(false)
    markDismissed('ws', storage)
    expect(isDismissed('ws', storage)).toBe(true)
    expect(isDismissed('other', storage)).toBe(false)
    clearDismissed(storage)
    expect(isDismissed('ws', storage)).toBe(false)
  })

  it('made before anything was stored, it carries over to the workspace the first write stores (verify4 defect 6)', () => {
    const storage = memory()
    markDismissed('unsaved', storage)
    expect(isDismissed('ws-first', storage)).toBe(true)
    expect(isDismissed('ws-first', storage)).toBe(true)
    expect(isDismissed('ws-other', storage)).toBe(false)
  })
})

// Drafts saved by b8d9c9f (version 2) and the plans that build made for them, recorded before the "Anything else?" loop
// changed what the answers mean. A draft from before the change must still write exactly what it would have written.
describe('a version 2 draft keeps the commit it was made for (S1-8)', () => {
  interface Fixture { about: string; document: 'stored' | 'firstRun'; draft: Record<string, unknown>; plan: unknown }
  const recorded = legacyDrafts as { fixtures: Record<string, Fixture> }
  const at = (hours: number) => hours * 60
  const documents = {
    stored: () => documentWith(
      [category('c-work', 'Work', { icon: '💼' }), category('c-family', 'Family', { icon: '👨‍👩‍👧', colorKey: 'pink' }), category('c-chess', 'Chess', { colorKey: 'green' })],
      [
        block('b-work', 'c-work', [1, 2, 3, 4, 5], at(9), at(17), { title: 'Work' }),
        block('b-family', 'c-family', [6], at(10), at(14), { title: 'Family' }),
        block('b-chess', 'c-chess', [2], at(18), at(19), { title: 'Chess' }),
      ],
      { settings: { ...documentWith().settings, onboardingDone: true } },
    ),
    firstRun: () => documentWith([], [], { settings: { ...documentWith().settings, onboardingDone: false } }),
  }

  const migrated = (name: string) => {
    const parsed = parseDraft(JSON.stringify(recorded.fixtures[name]!.draft))
    if (parsed === null || parsed === 'submitted') throw new Error(name)
    return parsed
  }
  const keyOf = (state: SetupState, id: string) => state.categories.find((item) => item.categoryId === id)!

  it('(a) and (b): a stored extra the old answer kept stays as it is', () => {
    for (const name of ['a', 'b']) {
      const state = migrated(name)
      expect(keyOf(state, 'c-family').removed, name).toBe(false)
      expect(statusOf(state, keyOf(state, 'c-family')), name).toBe('active')
    }
    expect(migrated('a').answers).toMatchObject({ more: null, moreDone: false })
  })

  it('(c): stored extras the old answer left out are marked removed, so the summary offers their Undo', () => {
    const state = migrated('c')
    expect([keyOf(state, 'c-family').removed, keyOf(state, 'c-chess').removed]).toEqual([true, true])
    expect(state.answers).toMatchObject({ more: ['learning'], moreDone: true })
  })

  it('(d): reopened "more" lands on the first round with both picks kept and the rounds still open', () => {
    const state = migrated('d')
    expect(state.screen).toBe('more')
    expect(state.answers).toMatchObject({ more: ['friends', 'custom:6'], moreDone: false })
    expect(sequence(state).slice(-6)).toEqual(['more', 'extra:friends', 'more:1', 'extra:custom:6', 'more:2', 'summary'])
  })

  it('(e): keeps all 21 picks, with no round open after them', () => {
    const state = migrated('e')
    expect(state.answers.more).toHaveLength(21)
    expect(MAX_PICKS).toBe(20)
    expect(isKnownScreen(state, 'more:20')).toBe(true)
    expect(isKnownScreen(state, 'more:21')).toBe(false)
    expect(sequence(state).at(-2)).toBe('extra:custom:37')
  })

  it('(f): on the times of a stored extra, it goes on to the next pick\'s times', () => {
    const state = migrated('f')
    expect(state.screen).toBe('extra:friends')
    expect(state.answers).toMatchObject({ more: ['friends'], moreDone: true })
  })

  it.each(Object.entries(recorded.fixtures))('(%s) plans what b8d9c9f planned', (_name, fixture) => {
    expect(fixture.draft.version).toBe(2)
    const parsed = parseDraft(JSON.stringify(fixture.draft))
    if (parsed === null || parsed === 'submitted') throw new Error(`the draft does not load: ${fixture.about}`)
    let id = 0
    expect(planSetupCommit(parsed, documents[fixture.document](), () => `n${++id}`)).toEqual(fixture.plan)
  })
})
