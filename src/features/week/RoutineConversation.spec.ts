// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, defineComponent, h, nextTick, type App } from 'vue'
import { i18n } from '@/i18n'
import type { Category, TimeBlock } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { useUndoToast } from '@/ui/undoToast'
import RoutineConversation, { type RoutineChange } from './RoutineConversation.vue'
import WeekView from './WeekView.vue'

const work: Category = { id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 45 } }
const block: TimeBlock = { id: 'b-work', categoryId: 'work', title: 'Work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 }

let app: App | undefined
afterEach(() => { useUndoToast().dismiss(); app?.unmount(); app = undefined; document.body.innerHTML = ''; vi.useRealTimers(); i18n.global.locale.value = 'en' })

const $ = <T extends HTMLElement = HTMLElement>(selector: string) => document.body.querySelector<T>(selector)
const tap = async (selector: string) => { $(selector)!.click(); await nextTick() }

function talk() {
  setActivePinia(createPinia())
  const changes: RoutineChange[] = []
  const events: string[] = []
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp(defineComponent({
    setup: () => () => h(RoutineConversation, {
      block, category: work, writable: true,
      onChange: (change: RoutineChange) => changes.push(change), onClose: () => events.push('close'), onEditAll: () => events.push('editAll'),
    }),
  })).use(i18n)
  app.mount(host)
  return { changes, events }
}

describe('a routine changed by talking (R_EditarRutina)', () => {
  it('says what the routine is and asks what to change, with the whole form one tap away', async () => {
    const { events } = talk()
    await nextTick()
    expect($('[data-testid=talk-context]')!.textContent).toMatch(/^Work · Mon–Fri · 9:00\s?AM\u2060?–\u2060?5:00\s?PM · 40 h$/)
    expect($('[data-testid=talk-question]')!.textContent).toBe('What do you want to change about Work?')
    expect([...document.body.querySelectorAll('.quick-reply')].map((node) => node.textContent?.trim())).toEqual(['Time', 'Days', 'Goal', 'Remove'])
    await tap('[data-testid=talk-edit-all]')
    await tap('.setup-close')
    expect(events).toEqual(['editAll', 'close'])
  })

  it('Time: a new start keeps the length, the end can be picked, and the week\'s hours follow', async () => {
    const { changes } = talk()
    await tap('[data-testid=talk-time]')
    expect($('[data-testid=talk-question]')!.textContent).toBe('When does it start and end?')
    expect($('[data-testid=talk-live]')!.textContent).toBe('40 h a week')
    await tap('[data-field=start] ~ .times [data-minute="600"]')
    expect($('[data-field=end]')!.getAttribute('aria-expanded')).toBe('true')
    await tap('[data-field=end] ~ .times [data-minute="840"]')
    expect($('[data-testid=talk-live]')!.textContent).toBe('20 h a week')
    await tap('[data-testid=talk-save]')
    expect(changes).toEqual([{ kind: 'block', block: { ...block, start: 600, end: 840 } }])
  })

  it('Days: a preset replaces the days', async () => {
    const { changes } = talk()
    await tap('[data-testid=talk-days]')
    await tap('[data-preset=everyDay]')
    await tap('[data-testid=talk-save]')
    expect(changes).toEqual([{ kind: 'block', block: { ...block, days: [0, 1, 2, 3, 4, 5, 6] } }])
  })

  it('Goal: the category\'s goal, with its hours; "No goal" needs none', async () => {
    const { changes } = talk()
    await tap('[data-testid=talk-goal]')
    expect($('[data-testid=talk-question]')!.textContent).toBe('What goal does Work have?')
    await tap('[data-testid=talk-goal-min]')
    const hours = $<HTMLInputElement>('[data-testid=talk-goal-hours]')!
    hours.value = '30'
    hours.dispatchEvent(new Event('input'))
    await nextTick()
    await tap('[data-testid=talk-save]')
    await tap('[data-testid=talk-goal-none]')
    expect($('[data-testid=talk-goal-hours]')).toBeNull()
    await tap('[data-testid=talk-save]')
    expect(changes).toEqual([
      { kind: 'goal', categoryId: 'work', goal: { type: 'min', hoursPerWeek: 30 } },
      { kind: 'goal', categoryId: 'work', goal: { type: 'none', hoursPerWeek: 0 } },
    ])
  })

  it('Remove: asks first; "Not now" goes back without removing', async () => {
    const { changes } = talk()
    await tap('[data-testid=talk-remove]')
    expect($('[data-testid=talk-question]')!.textContent).toBe('Remove Work from your week?')
    await tap('[data-testid=talk-remove-no]')
    expect($('[data-testid=routine-talk]')!.dataset.step).toBe('choose')
    await tap('[data-testid=talk-remove]')
    await tap('[data-testid=talk-remove-yes]')
    expect(changes).toEqual([{ kind: 'remove', blockId: 'b-work' }])
  })
})

describe('Week saves what the conversation says, with Deshacer', () => {
  it('a routine tapped in the grid opens the conversation; a new time is saved and Deshacer puts back the old one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-10-21T10:15:00Z'))
    const { planner } = createTestRepositories()
    configurePlannerStore({ repository: planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = usePlannerStore()
    await store.load()
    await store.commit((draft) => { draft.categories.push(work); draft.blocks.push(block) })
    i18n.global.locale.value = 'en'
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp(WeekView).use(pinia).use(i18n)
    app.mount(host)
    for (let i = 0; i < 5; i++) { await nextTick(); await new Promise((resolve) => setTimeout(resolve, 0)) }
    host.querySelector<HTMLButtonElement>('[data-block-id="b-work"]')!.click()
    await nextTick()
    expect($('[data-testid=routine-talk]')).not.toBeNull()
    await tap('[data-testid=talk-time]')
    await tap('[data-field=start] ~ .times [data-minute="600"]')
    await tap('[data-testid=talk-save]')
    await store.settled()
    await nextTick()
    expect(store.document!.blocks[0]).toMatchObject({ start: 600, end: 1080 })
    expect($('[data-testid=routine-talk]')).toBeNull()
    expect(useUndoToast().toast.value?.message).toBe('Done. Your week is saved.')
    useUndoToast().undo()
    await store.settled()
    expect(store.document!.blocks[0]).toMatchObject({ start: 540, end: 1020 })
  })
})
