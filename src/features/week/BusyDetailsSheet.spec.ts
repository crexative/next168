import { afterEach, expect, it, vi } from 'vitest'
import { mountForTest } from './mountForTest'
import BusyDetailsSheet from './BusyDetailsSheet.vue'

let unmount = () => undefined as void
afterEach(() => unmount())

it('disables conflict navigation when the planner is not editable', async () => {
  const onSelect = vi.fn()
  const mounted = await mountForTest(BusyDetailsSheet, {
    open: true,
    editable: false,
    details: { title: 'Sync', date: '2026-10-21', range: '09:00 – 10:00', calendar: 'Work', conflictsWith: [{ blockId: 'deep', title: 'Deep work' }] },
    onSelect,
  })
  unmount = mounted.unmount
  const button = document.querySelector<HTMLButtonElement>('[data-testid="busy-details-conflict"] button')
  expect(button).not.toBeNull()
  expect(button!.disabled).toBe(true)
  button!.click()
  expect(onSelect).not.toHaveBeenCalled()
})
