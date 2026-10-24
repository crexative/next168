import { afterEach, describe, expect, it, vi } from 'vitest'
import { mountForTest } from '@/features/week/mountForTest'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import TodayTimeline from './TodayTimeline.vue'
import { buildTimeline } from './todayTimeline'

let unmount = () => undefined as void
afterEach(() => unmount())

const TODAY = '2026-10-21'
const document = plannerDocument({ blocks: [deepWork, sleep] })
const { items } = buildTimeline({ document, today: TODAY, timeZone: 'UTC', external: [], placements: [] })
const SINCE = Date.parse('2026-10-20T00:00:00Z')

async function render(props: Record<string, unknown> = {}) {
  const mounted = await mountForTest(TodayTimeline, {
    items, allDay: [], actuals: [], categories: document.categories, now: new Date('2026-10-21T12:00:00Z'),
    timeZone: 'UTC', writable: true, planSince: SINCE, ...props,
  })
  unmount = mounted.unmount
  return mounted.host
}

describe('TodayTimeline rows', () => {
  it('collapses last night’s sleep to a single line without a status question', async () => {
    const host = await render()
    const carry = host.querySelector('[data-testid="timeline-carry"]')!
    expect(carry.textContent?.replace(/\s+/g, ' ').trim()).toMatch(/^Sleep\s*Since yesterday · until 6:00\sAM$/)
    const row = carry.closest('li')!
    expect(row.querySelector('[role="group"]')).toBeNull()
    expect(row.querySelector('[data-testid="timeline-start"]')).toBeNull()
  })

  it('asks about a finished block under the whole row, but not about the block the Now card asks about', async () => {
    const asked = await render()
    expect(asked.querySelectorAll('[role="group"]')).toHaveLength(1)
    expect(asked.querySelector('[role="group"]')?.getAttribute('aria-label')).toBe('How did Deep work go?')
    unmount()
    const delegated = await render({ currentKey: items.find((item) => item.kind === 'block' && item.title === 'Deep work')!.key })
    expect(delegated.querySelector('[role="group"]')).toBeNull()
  })

  it('does not ask about blocks that started before the plan existed, or that have not started', async () => {
    const late = await render({ planSince: Date.parse('2026-10-21T14:00:00Z') })
    expect(late.querySelector('[role="group"]')).toBeNull()
    unmount()
    const early = await render({ now: new Date('2026-10-21T08:00:00Z') })
    expect(early.querySelector('[role="group"]')).toBeNull()
  })

  it('shows three equal chips in one row with an icon slot each', async () => {
    const host = await render()
    const group = host.querySelector<HTMLElement>('.choices')!
    expect([...group.querySelectorAll('.choice')].map((chip) => chip.querySelector('.choice-label')?.textContent)).toEqual(['Done', 'Partial', 'Skipped'])
    expect(host.querySelector('li .row-actual')).not.toBeNull()
  })

  it('completes a task in one tap from its row', async () => {
    const onCompleteTask = vi.fn()
    const task = { kind: 'task' as const, key: 'task:t@10', title: 'Write report', start: '2026-10-21T13:00:00.000Z', end: '2026-10-21T14:00:00.000Z', conflict: false, taskId: 't', categoryId: 'work', late: false }
    const host = await render({ items: [task], onCompleteTask })
    const check = host.querySelector<HTMLButtonElement>('[data-testid="task-check"]')!
    expect(check.getAttribute('aria-label')).toBe('Complete Write report')
    check.click()
    expect(onCompleteTask).toHaveBeenCalledWith('t', 'Write report')
  })
})
