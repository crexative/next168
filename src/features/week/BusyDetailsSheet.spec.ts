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

// verify6 D7: the sheet only shows facts, so its one button closes it; an event's place and notes are shown.
it('closes with "Close" and shows the event\'s location and notes when it has them', async () => {
  // A phone: the sheet ends with its one button.
  const media = window.matchMedia
  window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  const mounted = await mountForTest(BusyDetailsSheet, {
    open: true,
    editable: true,
    details: { title: 'Cita médica', date: '2026-10-22', range: '6:00 PM – 7:00 PM', calendar: 'Next168 event', location: 'Consultorio 3', notes: 'Llevar exámenes\nEn ayunas', conflictsWith: [] },
  })
  unmount = () => { mounted.unmount(); window.matchMedia = media }
  const labels = Array.from(document.querySelectorAll('[role="dialog"] button')).map((button) => button.textContent?.trim())
  expect(labels).toContain('Close')
  expect(labels).not.toContain('Cancel')
  expect(document.querySelector('[data-testid="busy-details-location"] dd')?.textContent).toBe('Consultorio 3')
  expect(document.querySelector('[data-testid="busy-details-notes"] dd')?.textContent).toBe('Llevar exámenes\nEn ayunas')
})

it('shows no location or notes rows for an event without them', async () => {
  const mounted = await mountForTest(BusyDetailsSheet, {
    open: true,
    editable: true,
    details: { title: 'Sync', date: '2026-10-21', range: '09:00 – 10:00', calendar: 'Work', conflictsWith: [] },
  })
  unmount = mounted.unmount
  expect(document.querySelector('[data-testid="busy-details-location"]')).toBeNull()
  expect(document.querySelector('[data-testid="busy-details-notes"]')).toBeNull()
})
