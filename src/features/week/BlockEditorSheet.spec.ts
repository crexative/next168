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
    expect(save().disabled).toBe(true)

    await type('Title', 'Standup')
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
    const remove = [...dialog.querySelectorAll('button')].find((button) => button.textContent?.trim() === 'Delete block')!
    remove.click()
    expect(onDelete).toHaveBeenCalledWith('deep')
  })
})
