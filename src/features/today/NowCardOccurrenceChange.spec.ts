import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { i18n } from '@/i18n'
import { deepWork, plannerDocument } from '@/features/week/testDocument'
import NowCard from './NowCard.vue'
import { nowStateFor } from './nowStateFixtures'

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
      return h(NowCard, {
        state: nowStateFor(document, state.now.toISOString()), categories: document.categories, writable: true,
        today: '2026-10-21', timeZone: 'UTC', onRecord,
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
    host.querySelector<HTMLButtonElement>('[data-testid="answer-partial"]')!.click()
    await nextTick()
    const input = host.querySelector<HTMLInputElement>('[data-testid="now-minutes"] input')!
    input.value = '60'
    input.dispatchEvent(new Event('input'))
    await nextTick()

    state.now = new Date('2026-10-21T11:01:00Z')
    await nextTick()
    await nextTick()
    expect(host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Review')
    // Review is also in its last minutes, so the same buttons are reused: its draft must be gone.
    expect(host.querySelector('[data-testid="answer-done"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="now-minutes"]')).toBeNull()
    expect(onRecord).not.toHaveBeenCalled()
  })
})
