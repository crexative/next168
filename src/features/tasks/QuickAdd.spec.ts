// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId, testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, SLEEP, WORK, type Mounted } from '@/features/settings/testSupport'
import { LAST_TASK_CATEGORY_KEY } from './lastCategory'
import SmartCapture from './SmartCapture.vue'
import { pickWhen, whenNames, whenValue, whenValues } from './whenTestSupport'

const STUDY = { id: 'c-study', name: 'Study', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } } as const
const COMMUTE = { id: 'c-commute', name: 'Travel', icon: '🚌', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 } } as const
const done = { settings: { ...testDocument().settings, onboardingDone: true } }
let mounted: Mounted | undefined
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { mounted?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

const field = () => mounted!.host.querySelector<HTMLTextAreaElement>('form.add textarea')!
const details = () => mounted!.host.querySelector('[data-testid=task-details]')
async function type(text: string) { field().value = text; field().dispatchEvent(new Event('input')); await nextTick() }
// The box binds the planner (an async fingerprint) before it commits, so a few turns of the event loop pass first.
async function submit() {
  mounted!.host.querySelector<HTMLFormElement>('form.add')!.dispatchEvent(new Event('submit'))
  for (let turn = 0; turn < 10; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await mounted!.store.settled()
  }
  await nextTick()
}
const optionValues = () => whenValues(mounted!.host)
const lengthChip = (label: string) => [...details()!.querySelectorAll<HTMLLabelElement>('[data-testid=task-length] label')].find((chip) => chip.textContent?.trim() === label)!.querySelector('input')!

// Nueva tarea (R_HojaTarea): the title with its hint, the lengths, "When?" and "More options", all on screen at once.
it('shows the title with its hint, the lengths, "When?" and "More options" closed', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [WORK] })
  expect(field().placeholder).toBe('Task')
  expect(field().hasAttribute('data-autofocus')).toBe(true)
  expect(mounted.host.querySelector('.hint')!.textContent?.trim()).toBe('Paste or dictate several, one per line.')
  const chips = [...details()!.querySelectorAll('[data-testid=task-length] label')].map((chip) => chip.textContent?.trim())
  expect(chips).toEqual(['No time', '15 min', '30 min', '1 h', '2 h', 'Other'])
  expect(lengthChip('No time').checked).toBe(true)
  expect(whenValue(mounted!.host)).toBe('')
  // The due date, a fixed time, notes and the priority are one level deeper.
  const more = details()!.querySelector<HTMLElement>('[data-testid=task-more-options]')!
  expect(more.style.display).toBe('none')
  details()!.querySelector<HTMLButtonElement>('[data-testid=task-more]')!.click()
  await nextTick()
  expect(more.style.display).not.toBe('none')
  expect(more.querySelector('input[type=date]')).not.toBeNull()
})

it('"Other" opens a minutes field, and a length that is not a chip shows there', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [WORK] })
  await type('Read')
  expect(details()!.querySelector('[data-testid=task-other-duration]')).toBeNull()
  lengthChip('Other').click()
  await nextTick()
  const minutes = details()!.querySelector<HTMLInputElement>('[data-testid=task-other-duration]')!
  minutes.value = '45'
  minutes.dispatchEvent(new Event('change'))
  await nextTick()
  expect(lengthChip('Other').checked).toBe(true)
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Read', durationMin: 45 }])
})

it('adds with Enter using the defaults: a to-do with no time and no category', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [SLEEP, WORK] })
  await type('Buy a gift for mum')
  await submit()
  const [task] = mounted.store.document!.tasks
  expect(task).toMatchObject({ title: 'Buy a gift for mum', priority: 2 })
  expect(task).not.toHaveProperty('categoryId')
  expect(task).not.toHaveProperty('durationMin')
  expect(field().value).toBe('')
})

it('offers "any free slot" first and never Sleep or the commute', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [SLEEP, WORK, COMMUTE, STUDY] })
  await type('x')
  expect(optionValues()).toEqual(['', 'c-work', 'c-study'])
  expect(whenValue(mounted!.host)).toBe('')
  expect(whenNames(mounted!.host)).toEqual(['Any free slot', 'Work', 'Study'])
})

it('files the task under the category chosen with "During …" and takes the length from a chip', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [WORK, STUDY] })
  await type('Read a chapter')
  await pickWhen(mounted!.host, 'c-study')
  lengthChip('30 min').click()
  await nextTick()
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Read a chapter', categoryId: 'c-study', durationMin: 30 }])
})

const todayChip = () => mounted!.host.querySelector<HTMLInputElement>('[data-testid=task-today]')!

it('offers the last choice for the next task first in "During", never as its default, and across visits', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [WORK, STUDY] })
  await type('Read a chapter')
  expect(optionValues()).toEqual(['', 'c-work', 'c-study'])
  await pickWhen(mounted!.host, 'c-study')
  await submit()
  expect(localStorage.getItem(LAST_TASK_CATEGORY_KEY)).toBe('c-study')
  // An unrelated title does not silently inherit Study: Enter files it under any free slot.
  await type('Jog')
  expect(whenValue(mounted!.host)).toBe('')
  expect(optionValues()).toEqual(['', 'c-study', 'c-work'])
  await submit()
  expect(mounted.store.document!.tasks.find((task) => task.title === 'Jog')).not.toHaveProperty('categoryId')

  mounted.unmount()
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [WORK, STUDY] })
  await type('Fresh visit')
  expect(whenValue(mounted!.host)).toBe('')
  expect(optionValues()).toEqual(['', 'c-study', 'c-work'])
})

it('"Today" tapped after midnight in the planner\'s zone gives the new day, not the day the form was typed on', async () => {
  vi.setSystemTime(new Date('2026-10-26T04:50:00.000Z')) // 23:50 on the 25th in Bogotá
  mounted = await mountWithPlanner(SmartCapture, { ...done, settings: { ...done.settings, timeZone: 'America/Bogota' }, categories: [WORK] })
  await type('Jog')
  vi.setSystemTime(new Date('2026-10-26T05:10:00.000Z')) // 00:10 on the 26th in Bogotá
  todayChip().click()
  await nextTick()
  expect(todayChip().checked).toBe(true)
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: '2026-10-26' }])
})

it('"Today" tapped before midnight and added after it is due the new day (verify7)', async () => {
  vi.setSystemTime(new Date('2026-10-26T04:58:00.000Z')) // 23:58 on the 25th in Bogotá
  mounted = await mountWithPlanner(SmartCapture, { ...done, settings: { ...done.settings, timeZone: 'America/Bogota' }, categories: [WORK] })
  await type('Jog')
  todayChip().click()
  await nextTick()
  vi.setSystemTime(new Date('2026-10-26T05:03:00.000Z')) // 00:03 on the 26th
  document.dispatchEvent(new Event('visibilitychange'))
  await nextTick()
  expect(todayChip().checked).toBe(true)
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: '2026-10-26' }])
})

it('a length typed in the title that is not a chip shows under "Other", chosen', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [WORK] })
  await type('Call mum 45 min')
  const other = [...details()!.querySelectorAll<HTMLLabelElement>('[data-testid=task-length] label')].find((chip) => chip.querySelector('input')?.value === 'other')!.querySelector('input')!
  expect(other.checked).toBe(true)
})

it('opened from Hoy, «Hoy» starts on and, switched off, stays off: the task is saved with no date', async () => {
  mounted = await mountWithPlanner(defineComponent({ render: () => h(SmartCapture, { dueToday: true }) }), { ...done, categories: [WORK] })
  await type('Something with no date')
  expect(todayChip().checked).toBe(true)
  todayChip().click()
  await nextTick()
  expect(todayChip().checked).toBe(false)
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Something with no date' }])
  expect(mounted.store.document!.tasks[0]).not.toHaveProperty('dueDate')
})

it('"Today" in one tap makes the task due today; Enter still adds with no other tap', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [WORK] })
  await type('Jog')
  expect(todayChip().checked).toBe(false)
  todayChip().click()
  await nextTick()
  expect(todayChip().checked).toBe(true)
  await submit()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Jog', dueDate: fixedNow().toISOString().slice(0, 10) }])
  expect(mounted.store.document!.tasks[0]).not.toHaveProperty('categoryId')
})

it.each([
  ['a category that no longer exists', 'gone'],
  ['Sleep', 'c-sleep'],
])('does not offer a remembered choice that is %s: the task goes to any free slot', async (_name, remembered) => {
  localStorage.setItem(LAST_TASK_CATEGORY_KEY, remembered)
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [SLEEP, WORK] })
  await type('x')
  expect(whenValue(mounted!.host)).toBe('')
  await submit()
  expect(mounted.store.document!.tasks[0]).not.toHaveProperty('categoryId')
})

it('adds a task when there are no categories at all', async () => {
  mounted = await mountWithPlanner(SmartCapture, { ...done, categories: [] })
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
  const app = createApp(SmartCapture).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  await store.load()
  await nextTick()
  const input = host.querySelector<HTMLTextAreaElement>('form.add textarea')!
  input.value = 'x'
  input.dispatchEvent(new Event('input'))
  await nextTick()
  // The remembered choice is a suggestion: listed first once the categories are there, never applied by itself.
  expect(whenValue(host)).toBe('')
  expect(whenValues(host)).toEqual(['', 'c-study', 'c-work'])
  app.unmount()
  host.remove()
})
