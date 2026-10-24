import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { currentAndNext } from '@/core/now'
import { i18n } from '@/i18n'
import { deepWork, plannerDocument } from '@/features/week/testDocument'
import ActualChoices from './ActualChoices.vue'
import NowCard from './NowCard.vue'

// Two adjacent blocks: Deep work 09:00–11:00 (120 min) and Review 11:00–11:30 (30 min).
const review = { id: 'review', categoryId: 'work', title: 'Review', days: [1, 2, 3, 4, 5], start: 660, end: 690 }
const document = plannerDocument({ blocks: [deepWork, review] })

let unmount = () => undefined as void
afterEach(() => unmount())

function mountCard(at: string, onRecord: (...args: unknown[]) => void) {
  const state = reactive({ now: new Date(at) })
  const host = window.document.createElement('div')
  window.document.body.append(host)
  i18n.global.locale.value = 'en'
  const app = createApp({
    render: () => {
      const { current, next } = currentAndNext(document, state.now, 'UTC')
      return h(NowCard, {
        current, next, categories: document.categories, actuals: [], askable: true, writable: true,
        now: state.now, today: '2026-10-21', timeZone: 'UTC', onRecord,
      })
    },
  }).use(i18n)
  app.mount(host)
  unmount = () => { app.unmount(); host.remove() }
  return { host, state }
}

describe('NowCard when the current block changes', () => {
  it('drops an open Partial draft instead of recording its minutes against the next block', async () => {
    const onRecord = vi.fn()
    const { host, state } = mountCard('2026-10-21T10:59:00Z', onRecord)
    await nextTick()
    host.querySelector<HTMLButtonElement>('.choice.is-partial')!.click()
    await nextTick()
    const input = host.querySelector<HTMLInputElement>('.partial-input')!
    input.value = '60'
    input.dispatchEvent(new Event('input'))
    await nextTick()

    state.now = new Date('2026-10-21T11:01:00Z')
    await nextTick()
    expect(host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Review')
    expect(host.querySelector('.partial')).toBeNull()
    expect(onRecord).not.toHaveBeenCalled()
  })

  it('also drops the draft for the next day’s occurrence of the same block', async () => {
    const state = reactive({ start: '2026-10-21T09:00:00.000Z', end: '2026-10-21T11:00:00.000Z', date: '2026-10-21' })
    const host = window.document.createElement('div')
    window.document.body.append(host)
    i18n.global.locale.value = 'en'
    const app = createApp({
      render: () => h(ActualChoices, {
        occurrence: { blockId: 'deep', categoryId: 'work', title: 'Deep work', plannedMinutes: 120, ...state }, writable: true,
      }),
    }).use(i18n)
    app.mount(host)
    unmount = () => { app.unmount(); host.remove() }
    host.querySelector<HTMLButtonElement>('.choice.is-partial')!.click()
    await nextTick()
    expect(host.querySelector('.partial')).not.toBeNull()
    Object.assign(state, { start: '2026-10-22T09:00:00.000Z', end: '2026-10-22T11:00:00.000Z', date: '2026-10-22' })
    await nextTick()
    expect(host.querySelector('.partial')).toBeNull()
  })
})
