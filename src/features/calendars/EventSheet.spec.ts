// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { IDBFactory } from 'fake-indexeddb'
import { i18n } from '@/i18n'
import type { PlannerEvent } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { configureCalendarServices } from './calendarStore'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import EventSheet from './EventSheet.vue'

let app: App | undefined
let host: HTMLElement
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { app?.unmount(); host?.remove(); document.body.innerHTML = ''; app = undefined; vi.useRealTimers() })

async function open(event?: PlannerEvent) {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()), now: fixedNow })
  const planner = usePlannerStore()
  await planner.load()
  if (event) await planner.commit((draft) => { draft.events.push(event) })
  i18n.global.locale.value = 'en'
  const isOpen = ref(true)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp(defineComponent({ setup: () => () => h(EventSheet, { open: isOpen.value, event, 'onUpdate:open': (value: boolean) => { isOpen.value = value } }) })).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  await nextTick()
  return { planner, isOpen }
}

const dialog = () => document.body.querySelector<HTMLElement>('[role=dialog]')!
const labels = () => [...dialog().querySelectorAll('label')].map((label) => label.firstChild?.textContent?.trim() || label.textContent?.trim())
const field = (label: string) => [...dialog().querySelectorAll('label')].find((node) => node.textContent?.trim().startsWith(label))!.querySelector('input, textarea') as HTMLInputElement
async function type(label: string, value: string) {
  const input = field(label)
  input.value = value
  input.dispatchEvent(new Event('input', { bubbles: true }))
  await nextTick()
}
const submit = () => dialog().querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
const moreOptions = () => dialog().querySelector<HTMLElement>('.more-fields')!

describe('the event sheet', () => {
  it('asks for a title, a day, all day, and from–to; location and notes are one level deeper', async () => {
    await open()
    expect(labels()).toEqual(['Title', 'Day', 'All day', 'From', 'To', 'Location', 'Notes'])
    expect(moreOptions().style.display).toBe('none')
    dialog().querySelector<HTMLButtonElement>('[data-testid="event-more"]')!.click()
    await nextTick()
    expect(moreOptions().style.display).not.toBe('none')
  })

  it('has no attendees field and no time-zone line', async () => {
    await open()
    expect(dialog().querySelector('input[inputmode="email"]')).toBeNull()
    expect(dialog().textContent).not.toMatch(/Attendees|Time zone|Duration \(minutes\)/)
  })

  it('moves the end with the start and sets the length from the end, past midnight too', async () => {
    const { planner } = await open()
    await type('Title', 'Late call')
    await type('Day', '2026-10-24')
    await type('From', '22:00')
    expect(field('To').value).toBe('23:00')
    await type('From', '21:00')
    expect(field('To').value).toBe('22:00')
    await type('To', '01:30')
    submit()
    await vi.waitFor(() => expect(planner.document?.events).toHaveLength(1))
    expect(planner.document!.events[0]).toMatchObject({ title: 'Late call', start: '2026-10-24T21:00:00.000Z', end: '2026-10-25T01:30:00.000Z', allDay: false, attendees: [] })
  })

  it('refuses an end equal to the start and says so', async () => {
    const { planner } = await open()
    await type('Title', 'Zero')
    await type('Day', '2026-10-24')
    await type('From', '09:00')
    await type('To', '09:00')
    submit()
    await nextTick()
    expect(planner.document?.events).toEqual([])
    expect(dialog().querySelector('.calendar-error')?.textContent).toBe('Enter a title, a day and a valid time.')
  })

  it('opens the location and notes of an event that has them, and keeps the attendees it already had', async () => {
    const existing: PlannerEvent = { id: 'e1', title: 'Review', start: '2026-10-24T14:00:00.000Z', end: '2026-10-24T15:00:00.000Z', allDay: false, location: 'Room 2', notes: 'Bring slides', attendees: ['one@example.invalid'] }
    const { planner } = await open(existing)
    expect(moreOptions().style.display).not.toBe('none')
    expect(field('Location').value).toBe('Room 2')
    await type('To', '16:00')
    submit()
    await vi.waitFor(() => expect(planner.document!.events[0]!.end).toBe('2026-10-24T16:00:00.000Z'))
    expect(planner.document!.events[0]).toMatchObject({ id: 'e1', location: 'Room 2', attendees: ['one@example.invalid'] })
  })

  it('hides the times for an all-day event', async () => {
    await open()
    const allDay = field('All day')
    allDay.checked = true
    allDay.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    expect(labels()).not.toContain('From')
    expect(labels()).not.toContain('To')
  })
})
