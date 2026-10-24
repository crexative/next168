import { describe, expect, it } from 'vitest'
import { applyDraft, clearDraft, draftIdentity, draftOf, loadDraft, saveDraft } from './draftStorage'
import { CATEGORY_TEMPLATES, type TemplateChoice } from './templates'

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial))
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => { items.set(key, value) },
    removeItem: (key: string) => { items.delete(key) },
  }
}

const choices = (): TemplateChoice[] => CATEGORY_TEMPLATES.map((template) => ({
  templateId: template.id, selected: template.preselected === true, name: template.id, colorKey: template.colorKey, sketch: true, goal: { ...template.goal },
  routine: template.blocks.map((block) => ({ ...block, days: [...block.days] })),
}))
const identity = draftIdentity({ workspaceId: 'ws', revision: 4 })

describe('onboarding draft', () => {
  it('comes back for the same workspace revision, with the picks, edited times and task title', () => {
    const storage = memoryStorage()
    const edited = choices()
    edited.find((choice) => choice.templateId === 'exercise')!.selected = true
    edited.find((choice) => choice.templateId === 'work')!.routine = [{ start: 600, end: 1080, days: [1, 2, 3] }]
    edited.find((choice) => choice.templateId === 'work')!.name = 'Studio'
    saveDraft(draftOf(identity, 1, 'Call the bank', edited), storage)

    const saved = loadDraft(identity, 1, storage)!
    const restored = choices()
    applyDraft(restored, saved)
    expect(saved.step).toBe(1)
    expect(saved.taskTitle).toBe('Call the bank')
    expect(restored.find((choice) => choice.templateId === 'exercise')!.selected).toBe(true)
    expect(restored.find((choice) => choice.templateId === 'work')).toMatchObject({ name: 'Studio', routine: [{ start: 600, end: 1080, days: [1, 2, 3] }] })
  })

  it.each([
    ['another revision', draftIdentity({ workspaceId: 'ws', revision: 5 })],
    ['another workspace', draftIdentity({ workspaceId: 'other', revision: 4 })],
  ])('is dropped, not applied, for %s', (_name, current) => {
    const storage = memoryStorage()
    saveDraft(draftOf(identity, 1, 'Stale', choices()), storage)
    expect(loadDraft(current, 1, storage)).toBeNull()
    expect(storage.items.size).toBe(0)
  })

  it('is dropped when it is damaged or out of range', () => {
    const base = draftOf(identity, 1, '', choices())
    const broken = [
      '{not json',
      JSON.stringify({ ...base, step: 7 }),
      JSON.stringify({ ...base, choices: [{ ...base.choices[0], routine: [{ start: 600, end: 600, days: [1] }] }] }),
      JSON.stringify({ ...base, choices: [{ ...base.choices[0], routine: [{ start: 600, end: 700, days: [9] }] }] }),
      JSON.stringify({ ...base, choices: [{ ...base.choices[0], routine: [{ start: 600, end: 700, days: [] }] }] }),
    ]
    for (const raw of broken) {
      const storage = memoryStorage({ 'next168-onboarding-draft': raw })
      expect(loadDraft(identity, 1, storage)).toBeNull()
      expect(storage.items.size).toBe(0)
    }
  })

  it('does not rename or retime a category that keeps blocks of its own', () => {
    const kept = choices().map((choice) => choice.templateId === 'work' ? { ...choice, sketch: false } : choice)
    const edited = choices()
    edited.find((choice) => choice.templateId === 'work')!.name = 'Studio'
    edited.find((choice) => choice.templateId === 'work')!.routine = [{ start: 600, end: 700, days: [1] }]
    applyDraft(kept, draftOf(identity, 0, '', edited))
    expect(kept.find((choice) => choice.templateId === 'work')).toMatchObject({ name: 'work', routine: CATEGORY_TEMPLATES.find((template) => template.id === 'work')!.blocks })
  })

  it('can be cleared, and a storage that throws never breaks the wizard', () => {
    const storage = memoryStorage()
    saveDraft(draftOf(identity, 0, '', choices()), storage)
    clearDraft(storage)
    expect(storage.items.size).toBe(0)
    const failing = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') }, removeItem: () => { throw new Error('blocked') } }
    expect(() => saveDraft(draftOf(identity, 0, '', choices()), failing)).not.toThrow()
    expect(loadDraft(identity, 1, failing)).toBeNull()
    expect(() => clearDraft(failing)).not.toThrow()
  })
})
