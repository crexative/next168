import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import registerCalendars from '@/features/calendars'
import { configureCalendarServices, useCalendarStore } from '@/features/calendars/calendarStore'
import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import TasksView from './TasksView.vue'

let cleanup = () => undefined as void
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { cleanup(); setExternalOccurrenceSource(async () => []); vi.useRealTimers() })

it('places tasks around imported calendar events, not on top of them', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()), now: fixedNow })
  registerCalendars({ registerView: vi.fn(), registerSettingsSection: vi.fn() })
  const planner = usePlannerStore(), calendars = useCalendarStore()
  await planner.load()
  await planner.commit(draft => {
    draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
    draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', days: [6], start: 720, end: 840 })
    draft.tasks.push({ id: 'task', categoryId: 'work', title: 'Write report', durationMin: 60, priority: 1, createdAt: fixedNow().toISOString() })
  })
  await calendars.importFile('Team', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:busy\r\nDTSTART:20261024T120000Z\r\nDTEND:20261024T130000Z\r\nSUMMARY:Team meeting\r\nEND:VEVENT\r\nEND:VCALENDAR')

  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove() }
  await vi.waitFor(() => expect(host.textContent).toMatch(/(?<!\d)1:00\s?PM–2:00\s?PM/))
  expect(host.textContent).not.toMatch(/12:00\s?PM–/)

  await calendars.removeSource(planner.document!.calendarSources[0]!.id)
  await vi.waitFor(() => expect(host.textContent).toMatch(/12:00\s?PM–1:00\s?PM/))
})

it('offers a quickly added task "any free slot" by default, with Work but not Sleep as a choice', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  await planner.commit(draft => {
    draft.categories.push({ id: 'sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } })
    draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
  })
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove() }
  const when = () => host.querySelector<HTMLSelectElement>('[data-testid=task-when]')
  // "When?" appears once there is a title to file.
  expect(when()).toBeNull()
  const title = host.querySelector<HTMLInputElement>('input[type=text]')!
  title.value = 'Call the bank'
  title.dispatchEvent(new Event('input'))
  await vi.waitFor(() => expect(when()).not.toBeNull())
  expect(when()!.value).toBe('')
  expect([...when()!.options].map(option => option.value)).toEqual(['', 'work'])
})

it('places a task with no category in time no routine covers, and keeps it out of a block of another category', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  await planner.commit(draft => {
    draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
    // Saturday 12:00-14:00 is work; now is 12:00 on Saturday.
    draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', days: [6], start: 720, end: 840 })
    draft.tasks.push({ id: 'gift', title: 'Buy a gift for mum', durationMin: 60, priority: 2, createdAt: fixedNow().toISOString() })
  })
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove() }
  await vi.waitFor(() => expect(host.querySelectorAll('[data-testid=placed-task]')).toHaveLength(1))
  const text = host.querySelector('[data-testid=placed-task]')!.textContent!.replace(/\s+/g, ' ')
  expect(text).toMatch(/(?<!\d)2:00\s?PM–3:00\s?PM/)
  expect(text).not.toMatch(/Work/)
})

it('shows a task split around a busy slot as one row with its total duration and its fragments', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()), now: fixedNow })
  registerCalendars({ registerView: vi.fn(), registerSettingsSection: vi.fn() })
  const planner = usePlannerStore(), calendars = useCalendarStore()
  await planner.load()
  await planner.commit(draft => {
    draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
    draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', days: [6], start: 780, end: 900 })
    draft.tasks.push({ id: 'task', categoryId: 'work', title: 'Review open pull requests', durationMin: 60, priority: 1, createdAt: fixedNow().toISOString() })
  })
  await calendars.importFile('Team', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:busy\r\nDTSTART:20261024T134500Z\r\nDTEND:20261024T144500Z\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nEND:VCALENDAR')
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove() }
  await vi.waitFor(() => expect(host.textContent).toMatch(/(?<!\d)2:45\s?PM/))
  const rows = host.querySelectorAll('[data-testid=placed-task]')
  expect(rows).toHaveLength(1)
  const text = rows[0]!.textContent!.replace(/\s+/g, ' ')
  // Fragments start on the shared five-minute grid (the busy slot ends on it here).
  expect(text).toMatch(/(?<!\d)1:00\s?PM–1:45\s?PM, 2:45\s?PM–3:00\s?PM · Work · 1 h/)
  // The row has one circle to complete it and the text that opens it; removing is a swipe or the task sheet.
  expect(rows[0]!.querySelectorAll('button')).toHaveLength(2)
})
