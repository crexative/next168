import { describe, expect, it } from 'vitest'
import {
  bindingFor, clearDismissed, clearDraft, draftOf, idsMatchBaseline, isDismissed, loadDraft, markDismissed, parseDraft, parseSetupState,
  sameBinding, saveDraft, tabNonce,
} from './draftStorage'
import { createState, emptyState, ensureCategory, suggestRanges, type SetupState } from './setupModel'
import { block, category, documentWith, env } from './setupFixtures'

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
    ['a chip that is not a category', (value: ReturnType<typeof draft>) => { value.answers.more = ['ghost'] }],
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
