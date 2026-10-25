// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId, testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, SLEEP, WORK, type Mounted } from '@/features/settings/testSupport'
import { LAST_TASK_CATEGORY_KEY } from './lastCategory'
import TasksView from './TasksView.vue'

const STUDY = { id: 'c-study', name: 'Study', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } } as const
const COMMUTE = { id: 'c-commute', name: 'Travel', icon: '🚌', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 } } as const
const done = { settings: { ...testDocument().settings, onboardingDone: true } }
let mounted: Mounted | undefined
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { mounted?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

const field = () => mounted!.host.querySelector<HTMLInputElement>('form.add input[type=text]')!
const details = () => mounted!.host.querySelector('[data-testid=task-details]')
const when = () => mounted!.host.querySelector<HTMLSelectElement>('[data-testid=task-when]')!
async function type(text: string) { field().value = text; field().dispatchEvent(new Event('input')); await nextTick() }
async function submit() {
  mounted!.host.querySelector<HTMLFormElement>('form.add')!.dispatchEvent(new Event('submit'))
  await mounted!.store.settled()
}
const optionValues = () => [...when().options].map((option) => option.value)

it('starts as one "Add task…" field; the length and "More options" appear once there is a title', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [WORK] })
  expect(field().placeholder).toBe('Add task…')
  expect(mounted.host.querySelectorAll('form.add input, form.add select, form.add button')).toHaveLength(1)
  expect(details()).toBeNull()
  await type('Call the bank')
  const chips = [...details()!.querySelectorAll('[role=radiogroup] [role=radio]')].map((chip) => chip.textContent?.trim())
  expect(chips.slice(0, 4)).toEqual(['15 min', '30 min', '1 h', '2 h'])
  // "When?", the due date and the priority are one level deeper.
  const more = details()!.querySelector<HTMLElement>('[data-testid=task-more-options]')!
  expect(more.style.display).toBe('none')
  details()!.querySelector<HTMLButtonElement>('[data-testid=task-more]')!.click()
  await nextTick()
  expect(more.style.display).not.toBe('none')
  expect(more.querySelector('input[type=date]')).not.toBeNull()
  await type('   ')
  expect(details()).toBeNull()
})

it('adds with Enter using the defaults: a free slot, not a category', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [SLEEP, WORK] })
  await type('Buy a gift for mum')
  await submit()
  const [task] = mounted.store.document!.tasks
  expect(task).toMatchObject({ title: 'Buy a gift for mum', durationMin: 60, priority: 2 })
  expect(task).not.toHaveProperty('categoryId')
  expect(field().value).toBe('')
})

it('offers "any free slot" first and never Sleep or the commute', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [SLEEP, WORK, COMMUTE, STUDY] })
  await type('x')
  expect(optionValues()).toEqual(['', 'c-work', 'c-study'])
  expect(when().value).toBe('')
  expect([...when().options].map((option) => option.textContent?.trim())).toEqual(['Any free slot', 'During Work', 'During Study'])
})

it('files the task under the category chosen with "During …" and takes the length from a chip', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [WORK, STUDY] })
  await type('Read a chapter')
  when().value = 'c-study'
  when().dispatchEvent(new Event('change'))
  ;[...details()!.querySelectorAll<HTMLElement>('[role=radio]')].find((chip) => chip.textContent?.trim() === '30 min')!.click()
  await nextTick()
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Read a chapter', categoryId: 'c-study', durationMin: 30 }])
})

const suggestion = () => mounted!.host.querySelector<HTMLButtonElement>('[data-testid=task-suggested-category]')
const todayChip = () => mounted!.host.querySelector<HTMLButtonElement>('[data-testid=task-today]')!

it('offers the last choice for the next task only as a suggestion, never as its default, and across visits', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [WORK, STUDY] })
  await type('Read a chapter')
  expect(suggestion()).toBeNull()
  when().value = 'c-study'
  when().dispatchEvent(new Event('change'))
  await nextTick()
  await submit()
  expect(localStorage.getItem(LAST_TASK_CATEGORY_KEY)).toBe('c-study')
  // An unrelated title does not silently inherit Study: Enter files it under any free slot.
  await type('Jog')
  expect(when().value).toBe('')
  expect(suggestion()!.textContent?.trim()).toBe('During Study')
  expect(suggestion()!.getAttribute('aria-pressed')).toBe('false')
  await submit()
  expect(mounted.store.document!.tasks.find((task) => task.title === 'Jog')).not.toHaveProperty('categoryId')

  mounted.unmount()
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [WORK, STUDY] })
  await type('Fresh visit')
  expect(when().value).toBe('')
  expect(suggestion()!.textContent?.trim()).toBe('During Study')
  suggestion()!.click()
  await nextTick()
  expect(when().value).toBe('c-study')
  expect(suggestion()!.getAttribute('aria-pressed')).toBe('true')
  await submit()
  expect(mounted.store.document!.tasks.find((task) => task.title === 'Fresh visit')).toMatchObject({ categoryId: 'c-study' })
})

it('"Today" tapped after midnight in the planner\'s zone gives the new day, not the day the form was typed on', async () => {
  vi.setSystemTime(new Date('2026-10-26T04:50:00.000Z')) // 23:50 on the 25th in Bogotá
  mounted = await mountWithPlanner(TasksView, { ...done, settings: { ...done.settings, timeZone: 'America/Bogota' }, categories: [WORK] })
  await type('Jog')
  vi.setSystemTime(new Date('2026-10-26T05:10:00.000Z')) // 00:10 on the 26th in Bogotá
  todayChip().click()
  await nextTick()
  expect(todayChip().getAttribute('aria-pressed')).toBe('true')
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: '2026-10-26' }])
})

it('"Today" in one tap makes the task due today; Enter still adds with no other tap', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [WORK] })
  await type('Jog')
  expect(todayChip().getAttribute('aria-pressed')).toBe('false')
  todayChip().click()
  await nextTick()
  expect(todayChip().getAttribute('aria-pressed')).toBe('true')
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: fixedNow().toISOString().slice(0, 10) }])
  expect(mounted.store.document!.tasks[0]).not.toHaveProperty('categoryId')
})

it.each([
  ['a category that no longer exists', 'gone'],
  ['Sleep', 'c-sleep'],
])('does not offer a remembered choice that is %s: the task goes to any free slot', async (_name, remembered) => {
  localStorage.setItem(LAST_TASK_CATEGORY_KEY, remembered)
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [SLEEP, WORK] })
  await type('x')
  expect(when().value).toBe('')
  await submit()
  expect(mounted.store.document!.tasks[0]).not.toHaveProperty('categoryId')
})

it('adds a task when there are no categories at all', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [] })
  await type('Call the bank')
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Call the bank' }])
})

it('still suggests the remembered choice when the planner finishes loading after the view started', async () => {
  localStorage.setItem(LAST_TASK_CATEGORY_KEY, 'c-study')
  const pinia = createPinia()
  setActivePinia(pinia)
  const repos = createTestRepositories()
  configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  await repos.planner.save({ ...testDocument(), ...done, categories: [WORK, STUDY], revision: 1 }, 0)
  const store = usePlannerStore()
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(TasksView).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  // Nothing is shown yet: the document is not loaded.
  expect(host.querySelector('form.add')).toBeNull()
  await store.load()
  await nextTick()
  const input = host.querySelector<HTMLInputElement>('form.add input[type=text]')!
  input.value = 'x'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  // The remembered choice is a suggestion: offered once the categories are there, never applied by itself.
  expect(host.querySelector<HTMLSelectElement>('[data-testid=task-when]')!.value).toBe('')
  expect(host.querySelector('[data-testid=task-suggested-category]')!.textContent?.trim()).toBe('During Study')
  app.unmount()
  host.remove()
})
