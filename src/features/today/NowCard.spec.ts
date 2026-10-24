import { afterEach, describe, expect, it } from 'vitest'
import { currentAndNext } from '@/core/now'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { mountForTest } from '@/features/week/mountForTest'
import NowCard from './NowCard.vue'

const document = plannerDocument({ blocks: [deepWork, sleep] })
let unmount = () => undefined as void
afterEach(() => unmount())

async function render(now: string) {
  const { current, next } = currentAndNext(document, new Date(now), 'UTC')
  const mounted = await mountForTest(NowCard, { current, next, categories: document.categories, today: now.slice(0, 10), timeZone: 'UTC' })
  unmount = mounted.unmount
  const text = (id: string) => {
    const element = mounted.host.querySelector(`[data-testid="${id}"]`)!
    const parts = element.children.length ? [...element.children].map((child) => child.textContent) : [element.textContent]
    return parts.join(' ').replace(/\s+/g, ' ').trim()
  }
  return { host: mounted.host, text }
}

describe('NowCard', () => {
  it('shows the current block, minutes left, progress and the next block', async () => {
    const { host, text } = await render('2026-10-21T10:15:00Z')
    expect(text('now-title')).toBe('Deep work')
    expect(text('now-left')).toBe('45 min left')
    expect(host.querySelector('[role="progressbar"]')?.getAttribute('aria-valuenow')).toBe('63')
    expect(host.querySelector<HTMLElement>('.progress-fill')?.style.width).toBe('62.5%')
    expect(host.querySelector<HTMLElement>('.now-card')?.style.getPropertyValue('--block-color')).toBe('var(--cat-blue)')
    expect(text('now-next')).toMatch(/^Next Sleep 10:00\sPM$/)
  })

  it('names tomorrow and formats hours during an overnight block', async () => {
    const { text } = await render('2026-10-21T23:00:00Z')
    expect(text('now-title')).toBe('Sleep')
    expect(text('now-left')).toBe('7 h 0 min left')
    expect(text('now-next')).toMatch(/^Next Deep work Tomorrow, 9:00\sAM$/)
  })

  it('shows free time when nothing is running', async () => {
    const { host, text } = await render('2026-10-24T12:00:00Z')
    expect(text('now-title')).toBe('Free time')
    expect(host.querySelector('[role="progressbar"]')).toBeNull()
    expect(text('now-next')).toMatch(/^Next Sleep 10:00\sPM$/)
  })
})
