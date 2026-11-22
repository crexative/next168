// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import { addRange, emptyState, ensureCategory, suggestRanges, type SetupState } from '../setupModel'
import RangeList from './RangeList.vue'
import { registerIcons } from '@/ui/icons'
import { ChevronDown, ChevronUp, Clock, Moon, Sunrise } from 'lucide-vue-next'

registerIcons({ 'chevron-down': ChevronDown, 'chevron-up': ChevronUp, clock: Clock, moon: Moon, sunrise: Sunrise })

// The ranges of one category in the conversation (R_InicioHorario): "Quitar" only where it leaves a time, focus after a
// removal, and the category's hours a week.
let app: App | undefined
let host: HTMLElement | undefined

async function mount(options: { topic?: 'work' | 'sleep'; ranges?: number; loneRemovable?: boolean; inDock?: boolean } = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  i18n.global.locale.value = 'en'
  const state = reactive(emptyState()) as SetupState
  const topic = options.topic ?? 'work'
  const category = ensureCategory(state, topic, topic, topic === 'work' ? 'Work' : 'Sleep')
  suggestRanges(state, category)
  while (category.ranges.length < (options.ranges ?? 1)) addRange(state, category)
  host = document.createElement('div')
  if (options.inDock) host.dataset.testid = 'setup-dock'
  document.body.append(host)
  const labels = topic === 'sleep' ? { bed: 'Bedtime', wake: 'Wake up' } : undefined
  app = createApp({ render: () => h(RangeList, { state, category, labels, sleep: topic === 'sleep', loneRemovable: options.loneRemovable }) }).use(pinia).use(i18n)
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

  it('the first time opens on its start, unless its open times would push the answers out of the dock', async () => {
    await mount({ ranges: 1, inDock: true })
    expect(host!.querySelector('[data-field=start]')!.getAttribute('aria-expanded')).toBe('true')
    app!.unmount(); host!.remove()
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(900)
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400)
    await mount({ ranges: 1, inDock: true })
    await nextTick()
    expect(host!.querySelector('[data-field=start]')!.getAttribute('aria-expanded')).toBe('false')
    vi.restoreAllMocks()
  })

  const iconOf = (field: string) => host!.querySelector(`[data-field=${field}]`)!.querySelectorAll('svg')
  const icons = (field: string) => [...iconOf(field)].map((svg) => svg.getAttribute('class') ?? '').join(' ')

  it('choosing a set of days opens the start times', async () => {
    await mount({ ranges: 1 })
    const start = () => host!.querySelector('[data-field=start]')!
    ;(start() as HTMLButtonElement).click()
    await nextTick()
    expect(start().getAttribute('aria-expanded')).toBe('false')
    host!.querySelector<HTMLButtonElement>('[data-preset=weekend]')!.click()
    await nextTick()
    expect(start().getAttribute('aria-expanded')).toBe('true')
  })

  it('the open time\'s chevron points up and the closed one down', async () => {
    await mount({ ranges: 1 })
    expect(icons('start')).toContain('lucide-chevron-up')
    expect(icons('end')).toContain('lucide-chevron-down')
  })

  it('bedtime and wake-up carry a moon and a sunrise; other times a clock', async () => {
    await mount({ topic: 'sleep' })
    expect(icons('start')).toContain('lucide-moon')
    expect(icons('end')).toContain('lucide-sunrise')
    app!.unmount(); host!.remove()
    await mount({ topic: 'work' })
    expect(icons('start')).toContain('lucide-clock')
    expect(icons('end')).toContain('lucide-clock')
  })

  it('"Add another time" opens the new time on its start, and only that one', async () => {
    await mount({ ranges: 1 })
    host!.querySelector<HTMLButtonElement>('[data-testid=range-add]')!.click()
    await nextTick()
    const starts = [...host!.querySelectorAll('[data-field=start]')].map((row) => row.getAttribute('aria-expanded'))
    expect(starts).toEqual(['false', 'true'])
  })
})
