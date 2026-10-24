import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountForTest } from './mountForTest'
import BlockEditorSheet from './BlockEditorSheet.vue'
import type { BlockDraft } from './blockEditing'
import { deepWork, plannerDocument, sleep } from './testDocument'

const document = plannerDocument({ blocks: [deepWork, sleep] })
let unmount = () => undefined as void
afterEach(() => unmount())

async function render(draft: BlockDraft) {
  const onSave = vi.fn()
  const onDelete = vi.fn()
  const mounted = await mountForTest(BlockEditorSheet, { open: true, draft, document, onSave, onDelete })
  unmount = mounted.unmount
  await nextTick()
  const dialog = globalThis.document.querySelector<HTMLElement>('[role="dialog"]')!
  const input = (label: string) => [...dialog.querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(label))!.querySelector('input, select') as HTMLInputElement
  const type = async (label: string, value: string) => {
    const field = input(label)
    field.value = value
    field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input'))
    await nextTick()
  }
  const errors = () => [...dialog.querySelectorAll('[data-testid="editor-error"]')].map((item) => item.textContent?.trim())
  const save = () => dialog.querySelector<HTMLButtonElement>('button[type="submit"]')!
  return { dialog, type, errors, save, onSave, onDelete }
}

describe('BlockEditorSheet', () => {
  it('validates as the user types and blocks saving an overlap', async () => {
    const { type, errors, save, onSave } = await render({ title: '', categoryId: 'work', start: 720, end: 780, days: [3] })
    expect(errors()).toEqual([])

    await type('Name', 'Standup')
    expect(save().disabled).toBe(false)
    await type('Starts', '09:30')
    expect(errors()).toEqual(['Overlaps “Deep work”. Change the time or the days.'])
    expect(save().disabled).toBe(true)
    save().click()
    expect(onSave).not.toHaveBeenCalled()

    await type('Starts', '11:30')
    expect(errors()).toEqual([])
    save().click()
    expect(onSave).toHaveBeenCalledWith({ id: '__draft__', categoryId: 'work', title: 'Standup', days: [3], start: 690, end: 780 })
  })

  it('marks an end before the start as the next day', async () => {
    const { dialog, type } = await render({ title: 'Late shift', categoryId: 'work', start: 1080, end: 1200, days: [6] })
    expect(dialog.querySelector('[data-testid="next-day"]')).toBeNull()
    await type('Ends', '02:00')
    expect(dialog.querySelector('[data-testid="next-day"]')?.textContent?.trim()).toBe('+1 day')
  })

  it('offers delete for an existing block', async () => {
    const { dialog, onDelete } = await render({ id: 'deep', title: 'Deep work', categoryId: 'work', start: 540, end: 660, days: [1, 2, 3, 4, 5] })
    const remove = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Delete routine')!
    remove.click()
    expect(onDelete).toHaveBeenCalledWith('deep')
  })

  it('names the routine after its category until it is given a name of its own', async () => {
    const { dialog, type, save, onSave } = await render({ title: '', categoryId: 'work', start: 720, end: 780, days: [3] })
    const name = dialog.querySelector<HTMLInputElement>('input[type="text"]')!
    expect(name.value).toBe('')
    expect(name.placeholder).toBe('Work')
    expect(save().disabled).toBe(false)
    save().click()
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Work', categoryId: 'work' }))

    dialog.querySelector<HTMLElement>('[role="radio"][data-category-id="gym"]')!.click()
    await nextTick()
    expect(name.placeholder).toBe('Exercise')
    save().click()
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Exercise', categoryId: 'gym' }))

    await type('Name', 'Morning run')
    save().click()
    expect(onSave).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Morning run', categoryId: 'gym' }))
  })

  it('chooses the category with chips that move with the arrow keys, and shows the choice without colour alone', async () => {
    const { dialog } = await render({ title: 'Deep work', categoryId: 'work', start: 540, end: 660, days: [1] })
    const chips = () => [...dialog.querySelectorAll<HTMLElement>('[role="radiogroup"] [role="radio"]')]
    expect(chips().map((chip) => chip.textContent?.trim())).toEqual(['Work', 'Sleep', 'Exercise'])
    expect(chips().map((chip) => chip.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false'])
    expect(chips().map((chip) => chip.tabIndex)).toEqual([0, -1, -1])
    chips()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(chips().map((chip) => chip.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false'])
    expect(dialog.querySelectorAll('[data-testid="category-mark"]')).toHaveLength(3)
  })

  it('has no Cancel button: Save, a plain "Delete routine" for an existing one, and the close button', async () => {
    const { dialog } = await render({ id: 'deep', title: 'Deep work', categoryId: 'work', start: 540, end: 660, days: [1] })
    const labels = [...dialog.querySelectorAll('button:not([role="radio"])')].map((button) => button.textContent?.trim() || button.getAttribute('aria-label'))
    expect(labels).toContain('Save')
    expect(labels).toContain('Delete routine')
    expect(labels).not.toContain('Cancel')
  })
})
