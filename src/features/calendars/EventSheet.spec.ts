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

async function open(event?: PlannerEvent, timeZone = 'UTC') {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories({ timeZone: () => timeZone }).planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => timeZone })
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
  it('asks for a title, a day, all day, and from–to; guests, location and notes are one level deeper', async () => {
    await open()
    expect(labels()).toEqual(['Title', 'Day', 'All day', 'From', 'To', 'Guests', 'Location', 'Notes'])
    expect(moreOptions().style.display).toBe('none')
    dialog().querySelector<HTMLButtonElement>('[data-testid="event-more"]')!.click()
    await nextTick()
    expect(moreOptions().style.display).not.toBe('none')
  })

  it('has no time-zone line', async () => {
    await open()
    expect(dialog().textContent).not.toMatch(/Time zone|Duration \(minutes\)/)
  })

  const guestInput = () => dialog().querySelector<HTMLInputElement>('[data-testid="event-guest-input"]')!
  const chips = () => [...dialog().querySelectorAll('.guest-email')].map((node) => node.textContent)
  async function typeGuest(value: string, key?: string) {
    const input = guestInput()
    input.value = value
    input.dispatchEvent(new Event('input', { bubbles: true }))
    if (key) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
    await nextTick()
  }

  it('adds guests with Enter, a comma or Add, refuses what is not an email and removes one with its own button', async () => {
    const { planner } = await open()
    await type('Title', 'Planning')
    await type('Day', '2026-10-24')
    await typeGuest('one@example.com', 'Enter')
    expect(chips()).toEqual(['one@example.com'])
    expect(guestInput().value).toBe('')
    await typeGuest('not an email', 'Enter')
    expect(chips()).toEqual(['one@example.com'])
    expect(dialog().querySelector('.guests .calendar-error')?.textContent).toBe('Enter an email address, like name@example.com.')
    expect(guestInput().getAttribute('aria-invalid')).toBe('true')
    await typeGuest('two@example.com; ONE@example.com three@example.com')
    dialog().querySelector<HTMLButtonElement>('[data-testid="event-guest-add"]')!.click()
    await nextTick()
    expect(chips()).toEqual(['one@example.com', 'two@example.com', 'three@example.com'])
    expect(dialog().querySelector('.guests .calendar-error')).toBeNull()
    dialog().querySelector<HTMLButtonElement>('[aria-label="Remove three@example.com"]')!.click()
    await nextTick()
    expect(chips()).toEqual(['one@example.com', 'two@example.com'])
    submit()
    await vi.waitFor(() => expect(planner.document?.events).toHaveLength(1))
    expect(planner.document!.events[0]!.attendees).toEqual(['one@example.com', 'two@example.com'])
  })

  it('saving adds the address still being typed, and refuses to save one that is not an email', async () => {
    const { planner } = await open()
    await type('Title', 'Planning')
    await type('Day', '2026-10-24')
    await typeGuest('typo@')
    submit()
    await nextTick()
    expect(planner.document?.events).toEqual([])
    expect(moreOptions().style.display).not.toBe('none')
    await typeGuest('typed@example.com')
    submit()
    await vi.waitFor(() => expect(planner.document?.events).toHaveLength(1))
    expect(planner.document!.events[0]!.attendees).toEqual(['typed@example.com'])
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

  const fifty = Array.from({ length: 50 }, (_, index) => `guest${index}@example.com`)
  const fullEvent: PlannerEvent = { id: 'full', title: 'All hands', start: '2026-10-24T14:00:00.000Z', end: '2026-10-24T15:00:00.000Z', allDay: false, attendees: fifty }

  it('keeps a 51st address in the field, says why and does not save or close (review blocker)', async () => {
    const { planner, isOpen } = await open(fullEvent)
    expect(dialog().querySelector<HTMLButtonElement>('[data-testid="event-guest-add"]')!.disabled).toBe(true)
    expect(dialog().querySelector('[data-testid="event-guest-limit"]')?.textContent).toBe('An event can have up to 50 guests.')
    await type('Title', 'All hands, moved')
    await typeGuest('late@example.com')
    submit()
    await nextTick(); await nextTick()
    expect(isOpen.value).toBe(true)
    expect(guestInput().value).toBe('late@example.com')
    expect(dialog().querySelector('.guests .calendar-error')?.textContent).toBe('An event can have up to 50 guests.')
    expect(planner.document!.events[0]).toMatchObject({ title: 'All hands', attendees: fifty })
    // Making room lets the same typed address in, and the save goes through.
    dialog().querySelector<HTMLButtonElement>('[aria-label="Remove guest0@example.com"]')!.click()
    await nextTick()
    submit()
    await vi.waitFor(() => expect(isOpen.value).toBe(false))
    expect(planner.document!.events[0]!.attendees).toEqual([...fifty.slice(1), 'late@example.com'])
  })

  it('a paste of several addresses near the limit adds what fits and keeps the rest in the field', async () => {
    const { planner, isOpen } = await open({ ...fullEvent, attendees: fifty.slice(0, 49) })
    await typeGuest('fits@example.com, extra@example.com bad-one', 'Enter')
    expect(chips()).toHaveLength(50)
    expect(chips().at(-1)).toBe('fits@example.com')
    expect(guestInput().value).toBe('bad-one extra@example.com')
    submit()
    await nextTick(); await nextTick()
    expect(isOpen.value).toBe(true)
    expect(planner.document!.events[0]!.attendees).toHaveLength(49)
  })

  it('a typed value that loses nothing does not block the save: blank, or an address already listed', async () => {
    const { planner, isOpen } = await open({ ...fullEvent, attendees: ['one@example.com'] })
    await typeGuest('   ')
    await typeGuest('ONE@example.com')
    submit()
    await vi.waitFor(() => expect(isOpen.value).toBe(false))
    expect(planner.document!.events[0]!.attendees).toEqual(['one@example.com'])
  })

  it('opens the guests of an event that has only guests', async () => {
    await open({ id: 'g1', title: 'Sync', start: '2026-10-24T14:00:00.000Z', end: '2026-10-24T15:00:00.000Z', allDay: false, attendees: ['one@example.com'] })
    expect(moreOptions().style.display).not.toBe('none')
    expect(chips()).toEqual(['one@example.com'])
  })

  it('opens the location and notes of an event that has them, and keeps the attendees it already had', async () => {
    const existing: PlannerEvent = { id: 'e1', title: 'Review', start: '2026-10-24T14:00:00.000Z', end: '2026-10-24T15:00:00.000Z', allDay: false, location: 'Room 2', notes: 'Bring slides', attendees: ['one@example.invalid'] }
    const { planner } = await open(existing)
    expect(moreOptions().style.display).not.toBe('none')
    expect(chips()).toEqual(['one@example.invalid'])
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


describe('event end dates and daylight saving', () => {
  it.each([
    ['America/New_York', '2026-03-08', '01:30', '03:00', '2026-03-08T06:30:00.000Z', '2026-03-08T07:00:00.000Z'],
    ['America/New_York', '2026-11-01', '00:30', '03:00', '2026-11-01T04:30:00.000Z', '2026-11-01T08:00:00.000Z'],
    ['Europe/Madrid', '2026-03-29', '01:30', '03:00', '2026-03-29T00:30:00.000Z', '2026-03-29T01:00:00.000Z'],
    ['Europe/Madrid', '2026-10-25', '01:30', '03:00', '2026-10-24T23:30:00.000Z', '2026-10-25T02:00:00.000Z'],
  ])('saves the chosen local end in %s on %s', async (zone, day, from, to, start, end) => {
    const { planner } = await open(undefined, zone)
    await type('Title', 'DST call')
    await type('Day', day)
    await type('From', from)
    await type('To', to)
    expect(field('To').value).toBe(to)
    submit()
    await vi.waitFor(() => expect(planner.document?.events).toHaveLength(1))
    expect(planner.document!.events[0]).toMatchObject({ start, end })
  })

  it('displays the real local end when editing across a DST transition', async () => {
    await open({ id: 'dst', title: 'Call', start: '2026-03-08T06:30:00.000Z', end: '2026-03-08T07:00:00.000Z', allDay: false, attendees: [] }, 'America/New_York')
    expect(field('From').value).toBe('01:30')
    expect(field('To').value).toBe('03:00')
  })

  it('creates an all-day event through the selected inclusive end date', async () => {
    const { planner } = await open(undefined, 'America/New_York')
    await type('Title', 'Trip')
    await type('Day', '2026-10-24')
    const allDay = field('All day')
    allDay.checked = true
    allDay.dispatchEvent(new Event('change', { bubbles: true }))
    await nextTick()
    const end = dialog().querySelector<HTMLInputElement>('[data-testid=event-end-date]')
    expect(end).not.toBeNull()
    expect(end!.value).toBe('2026-10-24')
    end!.value = '2026-10-26'
    end!.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    submit()
    await vi.waitFor(() => expect(planner.document?.events).toHaveLength(1))
    expect(planner.document!.events[0]).toMatchObject({ start: '2026-10-24T00:00:00.000Z', end: '2026-10-27T00:00:00.000Z', allDay: true })
  })

  it('preserves and resizes an existing multi-day all-day event', async () => {
    const { planner, isOpen } = await open({ id: 'trip', title: 'Trip', start: '2026-10-24T00:00:00.000Z', end: '2026-10-27T00:00:00.000Z', allDay: true, attendees: [] })
    const end = dialog().querySelector<HTMLInputElement>('[data-testid=event-end-date]')
    expect(end).not.toBeNull()
    expect(end!.value).toBe('2026-10-26')
    await type('Title', 'Long trip')
    submit()
    await vi.waitFor(() => expect(isOpen.value).toBe(false))
    expect(planner.document!.events[0]!.end).toBe('2026-10-27T00:00:00.000Z')
    isOpen.value = true
    await nextTick()
    const reopened = dialog().querySelector<HTMLInputElement>('[data-testid=event-end-date]')!
    reopened.value = '2026-10-28'
    reopened.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()
    submit()
    await vi.waitFor(() => expect(planner.document!.events[0]!.end).toBe('2026-10-29T00:00:00.000Z'))
  })
})


it('can change an overnight end back to an end on the same day', async () => {
  const { planner } = await open()
  await type('Title', 'Call')
  await type('Day', '2026-10-24')
  await type('From', '09:00')
  await type('To', '08:00')
  await type('To', '10:00')
  submit()
  await vi.waitFor(() => expect(planner.document?.events).toHaveLength(1))
  expect(planner.document!.events[0]!.end).toBe('2026-10-24T10:00:00.000Z')
})
