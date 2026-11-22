// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { addRange, emptyState, ensureCategory, suggestRanges, type SetupState } from '../setupModel'
import RangeList from './RangeList.vue'

// The ranges of one category in the conversation (R_InicioHorario): "Quitar" only where it leaves a time, focus after a
// removal, and the category's hours a week.
let app: App | undefined
let host: HTMLElement | undefined

async function mount(options: { topic?: 'work' | 'sleep'; ranges?: number; loneRemovable?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  i18n.global.locale.value = 'en'
  const state = reactive(emptyState()) as SetupState
  const topic = options.topic ?? 'work'
  const category = ensureCategory(state, topic, topic, topic === 'work' ? 'Work' : 'Sleep')
  suggestRanges(state, category)
  while (category.ranges.length < (options.ranges ?? 1)) addRange(state, category)
  host = document.createElement('div')
  document.body.append(host)
  app = createApp({ render: () => h(RangeList, { state, category, sleep: topic === 'sleep', loneRemovable: options.loneRemovable }) }).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  return { category }
}
const removes = () => host!.querySelectorAll<HTMLButtonElement>('[data-testid=range-remove]')

afterEach(() => { app?.unmount(); host?.remove(); app = undefined; host = undefined })

describe('the ranges of a category in the conversation', () => {
  it('a lone time has no "Quitar" ("Sin horario fijo" leaves the category without times); two times both have it', async () => {
    await mount({ ranges: 1 })
    expect(removes()).toHaveLength(0)
    app!.unmount(); host!.remove()
    await mount({ ranges: 2 })
    expect(removes()).toHaveLength(2)
  })

  it('in the summary a lone time keeps "Quitar"', async () => {
    await mount({ ranges: 1, loneRemovable: true })
    expect(removes()).toHaveLength(1)
  })

  it('a removed time gives focus to "Añadir otro horario"', async () => {
    const { category } = await mount({ ranges: 2 })
    removes()[0]!.click()
    await nextTick()
    await nextTick()
    expect(category.ranges).toHaveLength(1)
    expect(document.activeElement).toBe(host!.querySelector('[data-testid=range-add]'))
  })

  it('says the category\'s hours a week, except for sleep', async () => {
    await mount({ topic: 'work' })
    expect(host!.querySelector('[data-testid=range-week-hours]')?.textContent).toMatch(/\d/)
    app!.unmount(); host!.remove()
    await mount({ topic: 'sleep' })
    expect(host!.querySelector('[data-testid=range-week-hours]')).toBeNull()
  })
})
