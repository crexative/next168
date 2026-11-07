import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mountForTest } from '@/features/week/mountForTest'
import { plannerDocument } from '@/features/week/testDocument'
import TodayTimeline from './TodayTimeline.vue'
import { at, block, event, expandEarlier, task } from './timelineFixtures'
import type { TimelineItem } from './todayTimeline'

let unmount = () => undefined as void
afterEach(() => unmount())

const document = plannerDocument()
const SINCE = at('00:00').getTime()
const answered = (item: TimelineItem & { kind: 'block' }) => ({
  date: '2026-11-06', blockId: item.occurrence.blockId, categoryId: 'work', plannedStartAt: item.start, plannedEndAt: item.end,
  plannedMinutes: item.occurrence.plannedMinutes, status: 'done' as const,
})

const commute = block('commute', '08:30', '09:00', 'Commute')
const work = block('work', '09:00', '17:00', 'Work')
const lunch = event('lunch', '12:30', '13:00', 'Lunch')
const exercise = block('exercise', '18:00', '19:00', 'Exercise')
const project = block('project', '19:00', '20:00', 'Project')
const sleep = block('sleep', '23:00', '23:59', 'Sleep')
const day = [commute, work, lunch, exercise, project, sleep]

async function render(now: string, props: Record<string, unknown> = {}) {
  const mounted = await mountForTest(TodayTimeline, {
    items: day, allDay: [], actuals: [answered(commute as never)], categories: document.categories, now: at(now),
    timeZone: 'UTC', writable: true, planSince: SINCE, ...props,
  })
  unmount = mounted.unmount
  return mounted.host
}

const titles = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="timeline-item"] .row-title-text')].map((node) => node.textContent?.replace(/\s+/g, ' ').trim())
const earlier = (host: HTMLElement) => host.querySelector<HTMLButtonElement>('[data-testid="timeline-earlier"]')!

describe('the folded "Earlier" row (check 6)', () => {
  it('is the first row, counts every past item and the unanswered blocks, and renders no past row while folded', async () => {
    const host = await render('19:19')
    const row = earlier(host)
    expect(row.closest('li')).toBe(host.querySelector('ol')!.firstElementChild)
    expect(row.textContent?.replace(/\s+/g, ' ').trim()).toContain('Earlier · 4')
    expect(host.querySelector('[data-testid="timeline-unanswered"]')?.textContent).toBe('2 to mark')
    expect(row.getAttribute('aria-expanded')).toBe('false')
    expect(row.hasAttribute('aria-controls')).toBe(false)
    // Only what has not ended is rendered: Project (current) and Sleep, and nothing ending at or before now.
    expect(titles(host).map((title) => title?.replace(/^.*?: ?/, ''))).toEqual(['Project', 'Sleep'])
  })

  it('opens to the past rows in time order, then folds them again and returns focus to the row', async () => {
    const host = await render('19:19', { actuals: [] })
    await expandEarlier(host)
    expect(earlier(host).getAttribute('aria-expanded')).toBe('true')
    expect(titles(host).map((title) => title?.replace(/^.*?: ?/, ''))).toEqual(['Commute', 'Work', 'Lunch', 'Exercise', 'Project', 'Sleep'])
    earlier(host).click()
    await nextTick()
    await nextTick()
    await vi.waitFor(() => expect(titles(host)).toHaveLength(2))
    expect(earlier(host).getAttribute('aria-expanded')).toBe('false')
  })

  it('opening moves focus to the first unanswered ring', async () => {
    const host = await mountAttached(await render('19:19'))
    await expandEarlier(host)
    const focused = window.document.activeElement as HTMLElement
    expect(focused.getAttribute('data-testid')).toBe('status-control')
    expect(focused.closest('[data-testid="timeline-item"]')?.textContent).toContain('Work')
    host.remove()
  })

  it('keeps focus on the row when the rings are off (read-only, check 28) or nothing waits for an answer', async () => {
    const readOnly = await mountAttached(await render('19:19', { writable: false }))
    await expandEarlier(readOnly)
    expect(window.document.activeElement).toBe(earlier(readOnly))
    readOnly.remove()
    unmount()
    const allAnswered = await mountAttached(await render('19:19', { actuals: [answered(commute as never), answered(work as never), answered(exercise as never)] }))
    expect(allAnswered.querySelector('[data-testid="timeline-unanswered"]')).toBeNull()
    await expandEarlier(allAnswered)
    expect(window.document.activeElement).toBe(earlier(allAnswered))
    allAnswered.remove()
  })

  it('is absent when nothing is past', async () => {
    const host = await render('07:00')
    expect(host.querySelector('[data-testid="timeline-earlier"]')).toBeNull()
  })

  it('counts a block that just ended once the Now card stops asking about it, so it is never hidden', async () => {
    const host = await render('21:00')
    expect(earlier(host).querySelector('.t-body')?.textContent).toMatch(/^Earlier\s·\s5$/)
    expect(host.querySelector('[data-testid="timeline-unanswered"]')?.textContent).toBe('3 to mark')
  })
})

describe('the now-line, free time and calendar rows', () => {
  it('puts the now-line after the folded row and the current row after it, with free time named between rows (check 7)', async () => {
    const host = await render('19:19')
    const order = [...host.querySelector('ol')!.children].map((child) => child.querySelector('[data-testid="timeline-now"]') ? 'now' : child.querySelector('[data-testid="timeline-gap"]') ? 'gap' : child.getAttribute('data-testid') === 'timeline-item' ? 'item' : 'earlier')
    expect(order).toEqual(['earlier', 'now', 'item', 'gap', 'item'])
    expect(host.querySelector('[data-testid="timeline-now"]')?.textContent?.replace(/\s/g, ' ')).toMatch(/^Now 7:19 PM$/)
    expect(host.querySelector('[data-testid="timeline-gap"]')?.textContent).toBe('Free · 3 h')
  })

  it('shows free time right under the now-line when nothing is current', async () => {
    const host = await render('20:30')
    const order = [...host.querySelector('ol')!.children].map((child) => child.querySelector('[data-testid="timeline-now"]') ? 'now' : child.querySelector('[data-testid="timeline-gap"]') ? 'gap' : child.getAttribute('data-testid') === 'timeline-item' ? 'item' : 'earlier')
    expect(order).toEqual(['earlier', 'now', 'gap', 'item'])
    expect(host.querySelector('[data-testid="timeline-gap"]')?.textContent).toBe('Free · 2 h 30 min')
  })

  it('does not name free time after the last item of the day', async () => {
    const host = await render('23:30')
    expect(host.querySelector('[data-testid="timeline-gap"]')).toBeNull()
  })

  it('draws a calendar item with a glyph and its source name, and makes it neither interactive nor focusable (check 10)', async () => {
    const google = { ...event('standup', '19:30', '20:00', 'Standup', 'external'), sourceName: 'Google Calendar' }
    const host = await render('19:19', { items: [project, google, sleep] })
    const row = [...host.querySelectorAll<HTMLElement>('[data-testid="timeline-item"]')].find((candidate) => candidate.querySelector('.row-title-text')?.textContent?.includes('Standup'))!
    expect(row.querySelector('svg')).not.toBeNull()
    expect(row.querySelector('.visually-hidden')?.textContent).toBe('Google Calendar: ')
    expect(row.querySelector('[data-testid="status-control"], button, a, [tabindex], [role="button"]')).toBeNull()
    expect(row.hasAttribute('tabindex')).toBe(false)
  })

  it('shows a late task chunk as Overdue and never as "Tarde"', async () => {
    const late = { ...task('t', '19:30', '20:00', 'Report'), late: true }
    const host = await render('19:19', { items: [project, late, sleep] })
    expect(host.querySelector('.badge.is-late')?.textContent).toBe('Overdue')
  })
})

// The focus checks need the component in the document.
async function mountAttached(host: HTMLElement): Promise<HTMLElement> {
  window.document.body.append(host)
  return host
}
