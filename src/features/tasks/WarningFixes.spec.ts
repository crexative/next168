// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { PlannerDocument, Task } from '@/core/model'
import { testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import { useUndoToast } from '@/ui/undoToast'
import TasksView from './TasksView.vue'

// The owner's report: on Sunday 25 Oct (Bogotá) "Trotar", filed under Trabajo and due that day, landed on Monday with
// "Cae después de su fecha límite" and only advice. A task can always be done today when there is time today, and
// every warning that remains has one-tap fixes.
const WORK = { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } } as const
const SLEEP = { id: 'c-sleep', name: 'Sueño', icon: '😴', colorKey: 'purple', goal: { type: 'none', hoursPerWeek: 0 } } as const
const SUNDAY_10_AM = new Date('2026-10-25T15:00:00.000Z')
const jog = (overrides: Partial<Task> = {}): Task => ({ id: 'jog', title: 'Trotar', categoryId: 'c-work', durationMin: 60, priority: 2, dueDate: '2026-10-25', createdAt: '2026-10-25T14:00:00.000Z', ...overrides })

function planner(tasks: Task[], extra: Partial<PlannerDocument> = {}): Partial<PlannerDocument> {
  return {
    settings: { ...testDocument().settings, onboardingDone: true, timeZone: 'America/Bogota' },
    categories: [WORK, SLEEP],
    blocks: [
      { id: 'b-work', categoryId: 'c-work', title: 'Trabajo', days: [1, 2, 3, 4, 5], start: 480, end: 1020 },
      { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
    ],
    tasks,
    ...extra,
  }
}

let mounted: Mounted | undefined
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(SUNDAY_10_AM) })
afterEach(() => { useUndoToast().dismiss(); mounted?.unmount(); mounted = undefined; vi.useRealTimers(); document.body.innerHTML = '' })

const find = (selector: string) => mounted!.host.querySelector<HTMLElement>(selector)
const text = (element: Element | null) => element?.textContent?.replace(/\s+/g, ' ').trim()

it("puts the owner's Sunday jog today in free time and says why, with no warning", async () => {
  mounted = await mountWithPlanner(TasksView, planner([jog()]), 'es')
  expect(find('[data-testid=task-warnings]')).toBeNull()
  const row = find('[data-testid=placed-task]')!
  expect(text(row)).toMatch(/Trotar ?10:00\D{0,8}–11:00/)
  expect(text(row.querySelector('[data-testid=outside-note]'))).toBe('Hoy no tienes bloque de Trabajo; la puse en tu tiempo libre.')
})

it('says the category time ran out when the category has a block today that is already used up', async () => {
  const document = planner([jog(), jog({ id: 'first', title: 'Informe', priority: 1 })])
  document.blocks!.push({ id: 'b-sunday', categoryId: 'c-work', title: 'Trabajo', days: [0], start: 600, end: 660 })
  mounted = await mountWithPlanner(TasksView, document, 'es')
  expect(text(find('[data-testid=outside-note]'))).toBe('Tu tiempo de Trabajo no alcanza antes de su fecha límite; la puse en tu tiempo libre.')
})

it('"Hacerla hoy" puts an overdue task in today\'s free time, and Undo gives back its due date', async () => {
  mounted = await mountWithPlanner(TasksView, planner([jog({ dueDate: '2026-10-24' })]), 'es')
  const card = find('[data-testid=warning-jog]')!
  expect(text(card.querySelector('[data-testid=late-text]'))).toBe('Cae después de su fecha límite (24 oct).')
  expect([...card.querySelectorAll('button')].map(text)).toEqual(['Hacerla hoy', 'Mover al 26 oct', 'Cambiar categoría'])
  card.querySelector<HTMLButtonElement>('[data-testid=fix-today]')!.click()
  await mounted.store.settled()
  await nextTick()
  expect(mounted.store.document!.tasks[0]!.dueDate).toBe('2026-10-25')
  expect(find('[data-testid=task-warnings]')).toBeNull()
  expect(text(find('[data-testid=placed-task]'))).toMatch(/10:00\D{0,8}–11:00/)
  expect(useUndoToast().toast.value?.message).toBe('«Trotar» queda para hoy')
  useUndoToast().undo()
  await mounted.store.settled()
  expect(mounted.store.document!.tasks[0]!.dueDate).toBe('2026-10-24')
})

it('with no free time left before the deadline, offers to move the due date to the day the task really ends', async () => {
  const busyDay = { events: [{ id: 'trip', title: 'Viaje', start: '2026-10-25T14:00:00.000Z', end: '2026-10-26T03:00:00.000Z', allDay: false, attendees: [] }] }
  mounted = await mountWithPlanner(TasksView, planner([jog()], busyDay), 'es')
  const card = find('[data-testid=warning-jog]')!
  expect(text(card.querySelector('[data-testid=late-text]'))).toBe('Cae después de su fecha límite (25 oct).')
  // Already due today, so "Hacerla hoy" would change nothing and is not offered.
  expect(card.querySelector('[data-testid=fix-today]')).toBeNull()
  const move = card.querySelector<HTMLButtonElement>('[data-testid=fix-move-due]')!
  expect(text(move)).toBe('Mover al 26 oct')
  move.click()
  await mounted.store.settled()
  await nextTick()
  expect(mounted.store.document!.tasks[0]!.dueDate).toBe('2026-10-26')
  expect(find('[data-testid=task-warnings]')).toBeNull()
  useUndoToast().undo()
  await mounted.store.settled()
  expect(mounted.store.document!.tasks[0]!.dueDate).toBe('2026-10-25')
})

it('says how much fits when only part of the task fits before the deadline', async () => {
  vi.setSystemTime(new Date('2026-10-26T02:30:00.000Z')) // Sunday 21:30 in Bogotá, half an hour before sleep
  mounted = await mountWithPlanner(TasksView, planner([jog()]), 'es')
  expect(text(find('[data-testid=late-text]'))).toBe('Solo hay hueco para 30 min antes de su fecha límite (25 oct).')
})

it('"Cambiar categoría" opens the task with its "When?" choice in view', async () => {
  mounted = await mountWithPlanner(TasksView, planner([jog({ dueDate: '2026-10-24' })]), 'es')
  find('[data-testid=fix-edit]')!.click()
  await nextTick()
  await nextTick()
  const dialog = document.body.querySelector<HTMLElement>('[role=dialog]')!
  expect(dialog.getAttribute('aria-label') ?? text(dialog.querySelector('h2'))).toContain('Editar tarea')
  expect(dialog.querySelector<HTMLSelectElement>('[data-testid=task-when]')!.value).toBe('c-work')
  expect(dialog.querySelector<HTMLElement>('[data-testid=task-more-options]')!.style.display).not.toBe('none')
})

it('a task in a category with no blocks at all offers "Hacerla hoy", which puts it in today\'s free time', async () => {
  const document = planner([jog({ categoryId: 'c-family', dueDate: undefined })])
  document.categories = [...document.categories!, { id: 'c-family', name: 'Familia', colorKey: 'pink', goal: { type: 'none', hoursPerWeek: 0 } }]
  mounted = await mountWithPlanner(TasksView, document, 'es')
  const card = find('[data-testid=warning-jog]')!
  expect(text(card.querySelector('[data-testid=overflow-text]'))).toBe('Faltan 1 h en Familia esta semana.')
  card.querySelector<HTMLButtonElement>('[data-testid=fix-today]')!.click()
  await mounted.store.settled()
  await nextTick()
  expect(mounted.store.document!.tasks[0]).toMatchObject({ categoryId: 'c-family', dueDate: '2026-10-25' })
  expect(find('[data-testid=task-warnings]')).toBeNull()
  expect(text(find('[data-testid=outside-note]'))).toBe('Hoy no tienes bloque de Familia; la puse en tu tiempo libre.')
})

it('"Hacerla hoy" tapped after midnight on a card drawn the evening before makes the task due the new day', async () => {
  vi.setSystemTime(new Date('2026-10-26T04:30:00.000Z')) // 23:30 on the 25th in Bogotá; no sleep block, so 15 min still fit
  const document = planner([jog({ dueDate: '2026-10-24', durationMin: 15 })])
  document.blocks = document.blocks!.filter((block) => block.id !== 'b-sleep')
  mounted = await mountWithPlanner(TasksView, document, 'es')
  const doToday = find('[data-testid=fix-today]')!
  vi.setSystemTime(new Date('2026-10-26T05:10:00.000Z')) // 00:10 on the 26th in Bogotá
  doToday.click()
  await mounted.store.settled()
  expect(mounted.store.document!.tasks[0]!.dueDate).toBe('2026-10-26')
})
