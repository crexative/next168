import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { i18n } from '@/i18n'
import { currentAndNext } from '@/core/now'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { mountForTest } from '@/features/week/mountForTest'
import NowCard from './NowCard.vue'

const document = plannerDocument({ blocks: [deepWork, sleep] })
let unmount = () => undefined as void
afterEach(() => { vi.restoreAllMocks(); unmount(); i18n.global.locale.value = 'en' })

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

  it('says when the free time ends, in one title, when the next block starts later today', async () => {
    const { host, text } = await render('2026-10-24T12:00:00Z')
    expect(text('now-title').replace(/\s/g, ' ')).toBe('Free time until 10:00 PM')
    expect(text('now-eyebrow')).toBe('Now')
    expect(host.querySelector('[data-testid="now-free-for"]')).toBeNull()
    expect(host.querySelector('[data-testid="status-control"]')).toBeNull()
    expect(host.querySelector('[role="progressbar"]')).toBeNull()
    expect(text('now-next')).toMatch(/^Next Sleep 10:00\sPM$/)
  })

  it('does not ask how a block went while most of it is still ahead', async () => {
    const { host } = await render('2026-10-21T10:15:00Z')
    expect(host.querySelector('[data-testid="status-control"]')).toBeNull()
    expect(host.querySelector('[data-testid="now-left"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="now-next"]')).not.toBeNull()
    expect(host.querySelector('[role="progressbar"]')).not.toBeNull()
  })

  it('asks in the last ten minutes of the block, and not a minute earlier', async () => {
    const early = await render('2026-10-21T10:49:30Z')
    expect(early.host.querySelector('[data-testid="status-control"]')).toBeNull()
    unmount()
    const { host } = await render('2026-10-21T10:50:00Z')
    expect(host.querySelector('[data-testid="status-control"]')?.getAttribute('aria-label')).toBe('Mark Deep work as done')
  })

  it('keeps showing an answer that was already given mid-block', async () => {
    const { host } = await render('2026-10-21T10:15:00Z', { actuals: [{
      date: '2026-10-21', blockId: 'deep', categoryId: 'work', plannedStartAt: '2026-10-21T09:00:00.000Z',
      plannedEndAt: '2026-10-21T11:00:00.000Z', plannedMinutes: 120, status: 'partial', actualMinutes: 30,
    }] })
    expect(host.querySelector('[data-testid="status-control"]')?.getAttribute('data-status')).toBe('partial')
  })

  it('does not ask about a block that started before the plan existed', async () => {
    const { host } = await render('2026-10-21T10:55:00Z', { askable: false })
    expect(host.querySelector('[data-testid="status-control"]')).toBeNull()
    expect(host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Deep work')
  })

  it('emits the chosen status for the current block', async () => {
    const onRecord = vi.fn()
    const { host } = await render('2026-10-21T10:55:00Z', { onRecord })
    host.querySelector<HTMLButtonElement>('[data-testid="status-control"]')!.click()
    expect(onRecord).toHaveBeenCalledWith(expect.objectContaining({ blockId: 'deep', title: 'Deep work' }), 'done', undefined)
  })

  it('agrees the Spanish article with the hour the free time ends at', async () => {
    const early = plannerDocument({ blocks: [{ id: 'early', categoryId: 'work', title: 'Early', days: [3], start: 60, end: 120 }] })
    const now = new Date('2026-10-20T23:00:00Z')
    const { current, next } = currentAndNext(early, now, 'UTC')
    const mounted = await mountForTest(NowCard, { current, next, categories: early.categories, actuals: [], askable: true, writable: true, now, today: '2026-10-20', timeZone: 'UTC' })
    unmount = mounted.unmount
    // Wednesday 2026-10-21 01:00 is the next start, but it is tomorrow for 2026-10-20: no end is named.
    expect(mounted.host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Free time')
    unmount()
    const sameDay = new Date('2026-10-21T00:10:00Z')
    const again = currentAndNext(early, sameDay, 'UTC')
    const second = await mountForTest(NowCard, { current: again.current, next: again.next, categories: early.categories, actuals: [], askable: true, writable: true, now: sameDay, today: '2026-10-21', timeZone: 'UTC' })
    unmount = second.unmount
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(second.host.querySelector('[data-testid="now-title"]')?.textContent?.replace(/\s/g, ' ')).toBe('Tiempo libre hasta la 1:00')
  })

  it('names no end for the free time when the next block starts on another day', async () => {
    const onlyWork = plannerDocument({ blocks: [deepWork] })
    const now = new Date('2026-10-21T12:00:00Z')
    const { current, next } = currentAndNext(onlyWork, now, 'UTC')
    const mounted = await mountForTest(NowCard, { current, next, categories: onlyWork.categories, actuals: [], askable: true, writable: true, now, today: '2026-10-21', timeZone: 'UTC' })
    unmount = mounted.unmount
    expect(mounted.host.querySelector('[data-testid="now-title"]')?.textContent).toBe('Free time')
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

// Widths model the browser's font measurements; happy-dom does not lay out text. A hyphen probe is as tall as the
// lines its text needs at its width (8 px a letter, 20 px a line).
function modelLayout(boxWidth: () => number): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const lineBox = (letters: number, width: number) => Math.max(1, Math.ceil((letters * 8) / width)) * 20
    let measured = boxWidth()
    let height = 20
    if (this.classList.contains('word-probe')) measured = (this.dataset.word?.length ?? 0) * 8
    if (this.classList.contains('hyphen-probe')) { measured = Number.parseFloat(this.style.width); height = lineBox((this.textContent ?? '').length, measured) }
    return { width: measured, height, left: 0, right: measured, top: 0, bottom: height, x: 0, y: 0, toJSON() {} }
  })
}

const visible = (label: Element) => label.querySelector('.whole-word-shown')!.textContent!.trim()
// What a screen reader reads: the text that is not hidden from it.
const accessibleText = (label: Element) => [...label.children].filter((child) => child.getAttribute('aria-hidden') !== 'true' && !child.classList.contains('word-probe') && !child.classList.contains('hyphen-probe')).map((child) => child.textContent).join('').trim()

it('fits the next title as whole words in two lines and restores it when room returns', async () => {
  let width = 157
  modelLayout(() => width)
  const title = 'Revisar presupuestos para el siguiente trimestre'
  const { host } = await render('2026-10-21T10:15:00Z', { next: { title, start: '2026-10-21T12:00:00Z' } })
  await nextTick()
  const label = () => host.querySelector('.now-next-title')!
  expect(visible(label())).toBe('Revisar presupuestos para…')
  expect(label().querySelector('.whole-word-shown')!.getAttribute('aria-hidden')).toBe('true')
  expect(accessibleText(label())).toBe(title)
  width = 600
  window.dispatchEvent(new Event('resize'))
  await nextTick()
  expect(visible(label())).toBe(title)
  expect(label().querySelector('.whole-word-shown')!.getAttribute('aria-hidden')).toBeNull()
  expect(accessibleText(label())).toBe(title)
})

it('hyphenates one over-wide word in the page language instead of drawing a bare ellipsis', async () => {
  modelLayout(() => 157)
  const word = 'Donaudampfschifffahrtsgesellschaft'
  const { host } = await render('2026-10-21T10:15:00Z', { next: { title: word, start: '2026-10-21T12:00:00Z' } })
  i18n.global.locale.value = 'de'
  await nextTick()
  const label = host.querySelector('.now-next-title')!
  expect(visible(label)).not.toBe('…')
  expect(visible(label).startsWith('Donaudampf')).toBe(true)
  expect(label.classList.contains('whole-word-hyphenated')).toBe(true)
  expect(label.getAttribute('lang')).toBe('de')
  expect(accessibleText(label)).toBe(word)
})

it('keeps the first over-wide word when more words follow, with the ellipsis after the whole word', async () => {
  modelLayout(() => 157)
  const { host } = await render('2026-10-21T10:15:00Z', { next: { title: 'Donaudampfschifffahrtsgesellschaft Jahresbericht', start: '2026-10-21T12:00:00Z' } })
  await nextTick()
  const label = host.querySelector('.now-next-title')!
  expect(visible(label)).toBe('Donaudampfschifffahrtsgesellschaft…')
  expect(accessibleText(label)).toBe('Donaudampfschifffahrtsgesellschaft Jahresbericht')
})

it('draws the whole title, broken anywhere and cut by its lines, when no hyphenation fits', async () => {
  modelLayout(() => 157)
  const word = 'Donaudampfschifffahrtsgesellschaftskapitaensmuetzenhersteller'
  const { host } = await render('2026-10-21T10:15:00Z', { next: { title: word, start: '2026-10-21T12:00:00Z' } })
  await nextTick()
  const label = host.querySelector('.now-next-title') as HTMLElement
  expect(visible(label)).toBe(word)
  expect(label.classList.contains('whole-word-anywhere')).toBe(true)
  expect(label.style.maxHeight).toBe('2lh')
})
