import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { currentAndNext } from '@/core/now'
import { i18n } from '@/i18n'
import { deepWork, plannerDocument } from '@/features/week/testDocument'
import NowCard from './NowCard.vue'

// Two adjacent blocks: Deep work 09:00–11:00 and a short Review 11:00–11:08, both inside the "last ten minutes" window at 11:01.
const review = { id: 'review', categoryId: 'work', title: 'Review', days: [1, 2, 3, 4, 5], start: 660, end: 668 }
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
  it('drops an open minutes draft instead of recording its minutes against the next block', async () => {
    const onRecord = vi.fn()
    const { host, state } = mountCard('2026-10-21T10:59:00Z', onRecord)
    await nextTick()
    host.querySelector('[data-testid="status-control"]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await nextTick()
    host.querySelector<HTMLButtonElement>('[data-testid="status-partial"]')!.click()
    await nextTick()
    const input = host.querySelector<HTMLInputElement>('[data-testid="status-minutes"] input')!
    input.value = '60'
    input.dispatchEvent(new Event('input'))
    await nextTick()

    state.now = new Date('2026-10-21T11:01:00Z')
    await nextTick()
    await nextTick()
    expect(host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Review')
    // Review is also in its last minutes, so the same control is reused: its draft must be gone.
    expect(host.querySelector('[data-testid="status-control"]')).not.toBeNull()
    // The draft leaves with its short fade.
    await vi.waitFor(() => expect(host.querySelector('[data-testid="status-minutes"]')).toBeNull())
    expect(onRecord).not.toHaveBeenCalled()
  })
})
