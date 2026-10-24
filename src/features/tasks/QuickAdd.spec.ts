// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { fixedNow, testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, SLEEP, WORK, type Mounted } from '@/features/settings/testSupport'
import { LAST_TASK_CATEGORY_KEY } from './lastCategory'
import TasksView from './TasksView.vue'

const STUDY = { id: 'c-study', name: 'Study', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } } as const
const done = { settings: { ...testDocument().settings, onboardingDone: true } }
let mounted: Mounted | undefined
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { mounted?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

const field = () => mounted!.host.querySelector<HTMLInputElement>('form.add input[type=text]')!
const details = () => mounted!.host.querySelector('[data-testid=task-details]')
async function type(text: string) { field().value = text; field().dispatchEvent(new Event('input')); await nextTick() }

it('starts as one "Add task…" field and reveals duration, category and date after typing', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [WORK] })
  expect(field().placeholder).toBe('Add task…')
  expect(mounted.host.querySelectorAll('form.add input, form.add select, form.add button')).toHaveLength(1)
  expect(details()).toBeNull()
  await type('Call the bank')
  expect(details()!.querySelector('select')).not.toBeNull()
  expect(details()!.querySelector('input[type=date]')).not.toBeNull()
  await type('   ')
  expect(details()).toBeNull()
})

it('adds with Enter using the defaults', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [SLEEP, WORK] })
  await type('Call the bank')
  mounted.host.querySelector<HTMLFormElement>('form.add')!.dispatchEvent(new Event('submit'))
  await mounted.store.settled()
  expect(mounted.store.document!.tasks).toMatchObject([{ title: 'Call the bank', categoryId: 'c-work', durationMin: 60 }])
  expect(field().value).toBe('')
})

it('remembers the last category for the next task, and across visits', async () => {
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [WORK, STUDY] })
  await type('Read a chapter')
  const category = [...details()!.querySelectorAll('select')].find((candidate) => candidate.querySelector('option[value="c-study"]'))!
  category.value = 'c-study'
  category.dispatchEvent(new Event('change'))
  await nextTick()
  mounted.host.querySelector<HTMLFormElement>('form.add')!.dispatchEvent(new Event('submit'))
  await mounted.store.settled()
  expect(localStorage.getItem(LAST_TASK_CATEGORY_KEY)).toBe('c-study')
  await type('Another one')
  const next = [...details()!.querySelectorAll('select')].find((candidate) => candidate.querySelector('option[value="c-study"]'))!
  expect(next.value).toBe('c-study')

  mounted.unmount()
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [WORK, STUDY] })
  await type('Fresh visit')
  expect([...details()!.querySelectorAll('select')].find((candidate) => candidate.querySelector('option[value="c-study"]'))!.value).toBe('c-study')
})

it('ignores a remembered category that no longer exists', async () => {
  localStorage.setItem(LAST_TASK_CATEGORY_KEY, 'gone')
  mounted = await mountWithPlanner(TasksView, { ...done, categories: [SLEEP, WORK] })
  await type('x')
  expect([...details()!.querySelectorAll('select')].find((candidate) => candidate.querySelector('option[value="c-work"]'))!.value).toBe('c-work')
})
