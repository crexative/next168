import { afterEach, describe, expect, it, vi } from 'vitest'
import { currentAndNext } from '@/core/now'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { mountForTest } from '@/features/week/mountForTest'
import NowCard from './NowCard.vue'

const document = plannerDocument({ blocks: [deepWork, sleep] })
let unmount = () => undefined as void
afterEach(() => unmount())

async function render(now: string, extra: Record<string, unknown> = {}) {
  const { current, next } = currentAndNext(document, new Date(now), 'UTC')
  const mounted = await mountForTest(NowCard, {
    current, next, categories: document.categories, actuals: [], askable: true, writable: true,
    now: new Date(now), today: now.slice(0, 10), timeZone: 'UTC', ...extra,
  })
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
    // A whole number of hours reads "7 h", never "7 h 0 min".
    expect(text('now-left')).toBe('7 h left')
    expect(text('now-next')).toMatch(/^Next Deep work Tomorrow, 9:00\sAM$/)
  })

  it('says "Unplanned" and how long it lasts when nothing is running', async () => {
    const { host, text } = await render('2026-10-24T12:00:00Z')
    expect(text('now-title')).toBe('Unplanned')
    expect(text('now-free-for')).toBe('in 10 h')
    expect(host.querySelector('.choices')).toBeNull()
    expect(host.querySelector('[role="progressbar"]')).toBeNull()
    expect(text('now-next')).toMatch(/^Next Sleep 10:00\sPM$/)
  })

  it('shows "in 1 h 30 min" when the next block starts later today', async () => {
    const { text } = await render('2026-10-21T20:30:00Z')
    expect(text('now-title')).toBe('Unplanned')
    expect(text('now-free-for')).toBe('in 1 h 30 min')
  })

  it('asks Done / Partial / Skipped inside the card for the current block, filled with an icon and aria-pressed', async () => {
    const { host } = await render('2026-10-21T10:15:00Z', { actuals: [{
      date: '2026-10-21', blockId: 'deep', categoryId: 'work', plannedStartAt: '2026-10-21T09:00:00.000Z',
      plannedEndAt: '2026-10-21T11:00:00.000Z', plannedMinutes: 120, status: 'partial', actualMinutes: 30,
    }] })
    const group = host.querySelector('.now-card [role="group"]')!
    expect(group.getAttribute('aria-label')).toBe('How did Deep work go?')
    const buttons = [...group.querySelectorAll<HTMLButtonElement>('button')]
    expect(buttons.map((button) => button.textContent?.trim())).toEqual(['Done', 'Partial', 'Skipped'])
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false'])
  })

  it('does not ask about a block that started before the plan existed', async () => {
    const { host } = await render('2026-10-21T10:15:00Z', { askable: false })
    expect(host.querySelector('[role="group"]')).toBeNull()
    expect(host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Deep work')
  })

  it('emits the chosen status for the current block', async () => {
    const onRecord = vi.fn()
    const { host } = await render('2026-10-21T10:15:00Z', { onRecord })
    host.querySelector<HTMLButtonElement>('.choice.is-done')!.click()
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'deep', title: 'Deep work' }), 'done', undefined)
  })

  it('does not promise a free duration when the next block starts on another day', async () => {
    const onlyWork = plannerDocument({ blocks: [deepWork] })
    const now = new Date('2026-10-21T12:00:00Z')
    const { current, next } = currentAndNext(onlyWork, now, 'UTC')
    const mounted = await mountForTest(NowCard, { current, next, categories: onlyWork.categories, actuals: [], askable: true, writable: true, now, today: '2026-10-21', timeZone: 'UTC' })
    unmount = mounted.unmount
    expect(mounted.host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Unplanned')
    expect(mounted.host.querySelector('[data-testid="now-free-for"]')).toBeNull()
  })

  it('writes exactly one hour in the shared duration format, without "0 min"', async () => {
    const { text } = await render('2026-10-21T10:00:00Z')
    expect(text('now-left')).toBe('1 h left')
  })

  it('keeps the progress bar between empty and full', async () => {
    const now = new Date('2026-10-21T10:15:00Z')
    const { current, next } = currentAndNext(document, now, 'UTC')
    const fill = async (progress: number) => {
      const mounted = await mountForTest(NowCard, { current: { ...current!, progress }, next, categories: document.categories, actuals: [], askable: true, writable: true, now, today: '2026-10-21', timeZone: 'UTC' })
      unmount = mounted.unmount
      const width = mounted.host.querySelector<HTMLElement>('.progress-fill')!.style.width
      mounted.unmount()
      return width
    }
    expect([await fill(1.7), await fill(-0.3)]).toEqual(['100%', '0%'])
  })
})
