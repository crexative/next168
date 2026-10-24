// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { i18n } from '@/i18n'
import { mountWithPlanner, SLEEP, WORK, type Mounted } from '../testSupport'
import CategorySettings from './CategorySettings.vue'
import { usageSummary } from './categoryEditing'

let mounted: Mounted | undefined
afterEach(() => { mounted?.unmount(); document.body.innerHTML = '' })

const blocks = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `b${index}`, categoryId: 'c-work', title: 'Work', days: [index % 7], start: 540, end: 600 }))
const tasks = (count: number) => Array.from({ length: count }, (_, index) => ({ id: `t${index}`, categoryId: 'c-work', title: 'Task', durationMin: 30, priority: 2 as const, createdAt: '2026-10-24T00:00:00.000Z' }))

async function openWork(): Promise<void> {
  mounted!.host.querySelector<HTMLButtonElement>('[data-testid=category-c-work] .category-button')!.click()
  await nextTick()
}

it('says "1 block and 1 task", "2 blocks" and "3 tasks" with the right plural of each', async () => {
  const plural = (key: string, count: number) => i18n.global.t(key, { count }, count)
  const join = (key: string, params: Record<string, unknown>) => i18n.global.t(key, params)
  i18n.global.locale.value = 'en'
  expect(usageSummary(plural, join, { blocks: 1, tasks: 1 })).toBe('1 block and 1 task')
  expect(usageSummary(plural, join, { blocks: 2, tasks: 0 })).toBe('2 blocks')
  expect(usageSummary(plural, join, { blocks: 0, tasks: 3 })).toBe('3 tasks')
  i18n.global.locale.value = 'es'
  expect(usageSummary(plural, join, { blocks: 1, tasks: 2 })).toBe('1 bloque y 2 tareas')
  expect(usageSummary(plural, join, { blocks: 2, tasks: 1 })).toBe('2 bloques y 1 tarea')
})

it('starts the move destination empty and only deletes once one is chosen', async () => {
  mounted = await mountWithPlanner(CategorySettings, { categories: [WORK, SLEEP], blocks: blocks(1), tasks: tasks(2) })
  await openWork()
  const zone = document.body.querySelector('.danger-zone')!
  expect(zone.querySelector('[data-testid=category-usage]')!.textContent).toBe('This category has 1 block and 2 tasks. To delete it, move everything to another category.')
  const select = zone.querySelector<HTMLSelectElement>('select')!
  expect(select.value).toBe('')
  const remove = zone.querySelector<HTMLButtonElement>('button')!
  expect(remove.disabled).toBe(true)
  select.value = 'c-sleep'
  select.dispatchEvent(new Event('change'))
  await nextTick()
  expect(remove.disabled).toBe(false)
})
