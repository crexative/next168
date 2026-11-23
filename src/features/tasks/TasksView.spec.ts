import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick } from 'vue'
import { IDBFactory } from 'fake-indexeddb'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import registerCalendars from '@/features/calendars'
import { configureCalendarServices, useCalendarStore } from '@/features/calendars/calendarStore'
import { IndexedDbCalendarSourceStore } from '@/features/calendars/calendarSourceStore'
import { setExternalOccurrenceSource } from '@/features/week/externalOccurrences'
import TasksView from './TasksView.vue'
import { categoryColor } from '@/features/insights/categoryColor'

let cleanup = () => undefined as void
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { cleanup(); setExternalOccurrenceSource(async () => []); vi.useRealTimers() })

it('places tasks around imported calendar events, not on top of them', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()), now: fixedNow })
  registerCalendars({ registerView: vi.fn(), registerSettingsSection: vi.fn(), registerAddEntry: vi.fn() })
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
  await vi.waitFor(() => expect(host.textContent).toMatch(/(?<!\d)1:00\s?PM\u2060–\u20602:00\s?PM/))
  expect(host.textContent).not.toMatch(/12:00\s?PM\u2060–/)

  await calendars.removeSource(planner.document!.calendarSources[0]!.id)
  await vi.waitFor(() => expect(host.textContent).toMatch(/12:00\s?PM\u2060–\u20601:00\s?PM/))
})

// R_Tareas: the count is the subtitle, there is no capture box on the page (it is Nueva tarea's title), group titles
// carry no counts, and "Hechas recientemente · 1" starts closed.
it('says how many are pending, has no capture box, and keeps done tasks behind a closed disclosure', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  await planner.commit(draft => {
    draft.tasks.push({ id: 'a', title: 'Call the bank', priority: 2, createdAt: fixedNow().toISOString() })
    draft.tasks.push({ id: 'b', title: 'Read a chapter', priority: 2, createdAt: fixedNow().toISOString() })
    draft.tasks.push({ id: 'c', title: 'Pay the bill', priority: 2, createdAt: fixedNow().toISOString(), doneAt: fixedNow().toISOString() })
  })
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove() }
  await nextTick()
  expect(host.querySelector('[data-testid=tasks-subtitle]')!.textContent).toBe('2 to do')
  expect(host.querySelector('textarea, [data-testid=capture-field]')).toBeNull()
  expect([...host.querySelectorAll('.group-title')].map(node => node.textContent)).toEqual(['No date'])
  const toggle = host.querySelector<HTMLButtonElement>('[data-testid=done-toggle]')!
  expect(toggle.textContent?.replace(/\s+/g, ' ').trim()).toBe('Recently done · 1')
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(host.querySelector<HTMLElement>('#task-done-list')!.style.display).toBe('none')
  toggle.click()
  await nextTick()
  expect(host.querySelector<HTMLElement>('#task-done-list')!.style.display).toBe('')
  expect(host.querySelector('[data-testid=done-task]')!.textContent).toContain('Pay the bill')
})

// R_Tareas rows (review of #69): today's group is just "Today"; a row names its due date only when the group is
// another day; a to-do with nothing else to say says "No time"; an uncategorised task's ring is label-2, not a colour.
it('titles today\'s group "Today", leaves out a due date the group already says, and says "No time" for a bare to-do', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  await planner.commit(draft => {
    draft.tasks.push({ id: 'a', title: 'Due today', durationMin: 30, dueDate: '2026-10-24', priority: 2, createdAt: fixedNow().toISOString() })
    draft.tasks.push({ id: 'b', title: 'Due tomorrow', durationMin: 30, dueDate: '2026-10-25', priority: 2, createdAt: fixedNow().toISOString() })
    draft.tasks.push({ id: 'c', title: 'Bare to-do', priority: 2, createdAt: fixedNow().toISOString() })
    draft.categories.push({ id: 'home', name: 'Home', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } })
    draft.tasks.push({ id: 'd', title: 'Filed at home', categoryId: 'home', priority: 2, createdAt: fixedNow().toISOString() })
  })
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove() }
  await nextTick()
  const row = (title: string) => [...host.querySelectorAll<HTMLElement>('li.task-row')].find(node => node.textContent?.includes(title))!
  const meta = (title: string) => row(title).querySelector('.meta')?.textContent?.replace(/\s+/g, ' ').trim()
  expect([...host.querySelectorAll('.group-title')].map(node => node.textContent)).toContain('Today')
  expect(row('Due today').closest('section')!.querySelector('.group-title')!.textContent).toBe('Today')
  expect(row('Due tomorrow').closest('section')!.querySelector('.group-title')!.textContent).toBe('Today')
  expect(meta('Due today')).not.toMatch(/\bdue\b/)
  expect(meta('Due tomorrow')).toMatch(/\bdue\b/)
  expect(meta('Bare to-do')).toBe('No time')
  expect(row('Bare to-do').querySelector<HTMLElement>('.check-ring')!.style.borderColor).toBe('var(--label-2)')
  // A task filed under a category takes that category's colour.
  expect(row('Filed at home').querySelector<HTMLElement>('.check-ring')!.style.borderColor).toBe(categoryColor({ colorKey: 'green' }))
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
  expect(text).toMatch(/(?<!\d)2:00\s?PM\u2060–\u20603:00\s?PM/)
  expect(text).not.toMatch(/Work/)
})

it('shows a task split around an off-grid busy slot as one row with five-minute starts and its exact total duration', async () => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  configureCalendarServices({ texts: new IndexedDbCalendarSourceStore(new IDBFactory()), now: fixedNow })
  registerCalendars({ registerView: vi.fn(), registerSettingsSection: vi.fn(), registerAddEntry: vi.fn() })
  const planner = usePlannerStore(), calendars = useCalendarStore()
  await planner.load()
  await planner.commit(draft => {
    draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
    draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', days: [6], start: 780, end: 910 })
    draft.tasks.push({ id: 'task', categoryId: 'work', title: 'Review open pull requests', durationMin: 60, priority: 1, createdAt: fixedNow().toISOString() })
  })
  await calendars.importFile('Team', 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:busy\r\nDTSTART:20261024T134600Z\r\nDTEND:20261024T144600Z\r\nSUMMARY:Standup\r\nEND:VEVENT\r\nEND:VCALENDAR')
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove() }
  await vi.waitFor(() => expect(host.textContent).toMatch(/(?<!\d)1:00\s?PM\u2060–\u20601:46\s?PM/))
  const rows = host.querySelectorAll('[data-testid=placed-task]')
  expect(rows).toHaveLength(1)
  const text = rows[0]!.textContent!.replace(/\s+/g, ' ')
  // Only starts snap: the first fragment keeps the busy boundary, and the final 14 minutes stay exact.
  expect(text).toMatch(/(?<!\d)1:00\s?PM\u2060–\u20601:46\s?PM, 2:50\s?PM\u2060–\u20603:04\s?PM · Work · 1 h/)
  // The row has one circle to complete it and the text that opens it; removing is a swipe or the task sheet.
  expect(rows[0]!.querySelectorAll('button')).toHaveLength(2)
})

it('starts a task at the next five-minute boundary after now, keeping its exact duration', async () => {
  vi.setSystemTime(new Date('2026-10-24T13:01:00.000Z'))
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  await planner.commit(draft => {
    draft.categories.push({ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
    draft.blocks.push({ id: 'focus', categoryId: 'work', title: 'Focus', days: [6], start: 780, end: 850 })
    draft.tasks.push({ id: 'task', categoryId: 'work', title: 'Write report', durationMin: 60, priority: 1, createdAt: fixedNow().toISOString() })
  })
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove() }

  await vi.waitFor(() => expect(host.querySelectorAll('[data-testid=placed-task]')).toHaveLength(1))
  const text = host.querySelector('[data-testid=placed-task]')!.textContent!.replace(/\s+/g, ' ')
  expect(text).toMatch(/(?<!\d)1:05\s?PM\u2060–\u20602:05\s?PM · Work · 1 h/)
  expect(host.querySelector('[data-testid=task-warnings]')).toBeNull()
})

it.each(['en', 'es', 'fr', 'pt', 'de'])('keeps the entire due phrase and its date together (%s)', async (locale) => {
  const pinia = createPinia()
  setActivePinia(pinia)
  configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => locale, timeZone: () => 'UTC' })
  const planner = usePlannerStore()
  await planner.load()
  await planner.commit(draft => {
    draft.tasks.push({ id: 'due', title: 'Revisar presupuestos', durationMin: 60, priority: 1, createdAt: fixedNow().toISOString(), dueDate: '2026-10-26' })
  })
  i18n.global.locale.value = locale
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  cleanup = () => { app.unmount(); host.remove(); i18n.global.locale.value = 'en' }
  await nextTick()
  const subtitle = host.querySelector('.task-text .t-footnote')!.textContent!
  const due = subtitle.split('·').at(-1)!.trim()
  expect(due).not.toContain(' ')
  expect(due).toContain('\u00a0')
  expect(subtitle).toContain('\u00a0· ')
})
