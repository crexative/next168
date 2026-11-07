import { afterEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { i18n } from '@/i18n'
import { deepWork, plannerDocument, sleep } from '@/features/week/testDocument'
import { mountForTest } from '@/features/week/mountForTest'
import NowCard from './NowCard.vue'
import { nowStateFor } from './nowStateFixtures'

const document = plannerDocument({ blocks: [deepWork, sleep] })
let unmount = () => undefined as void
afterEach(() => { vi.restoreAllMocks(); unmount(); i18n.global.locale.value = 'en' })

async function render(now: string, extra: Record<string, unknown> = {}, doc = document, stateOptions: Parameters<typeof nowStateFor>[2] = {}) {
  const mounted = await mountForTest(NowCard, {
    state: nowStateFor(doc, now, stateOptions), categories: doc.categories, writable: true, today: now.slice(0, 10), timeZone: 'UTC', ...extra,
  })
  unmount = mounted.unmount
  const text = (id: string) => mounted.host.querySelector(`[data-testid="${id}"]`)?.textContent?.replace(/\s+/g, ' ').trim()
  return { host: mounted.host, text }
}

const buttons = (host: HTMLElement) => [...host.querySelectorAll('[data-testid="now-do"] button')].map((button) => button.textContent?.trim())

describe('NowCard', () => {
  it('shows the current block, the minutes left, until when, progress and the next block', async () => {
    const { host, text } = await render('2026-10-21T10:15:00Z')
    expect(text('now-title')).toBe('Deep work')
    expect(text('now-left')).toBe('45 min left')
    expect(text('now-until')).toMatch(/^until 11:00\sAM$/)
    const bar = host.querySelector('[role="progressbar"]')!
    expect(bar.getAttribute('aria-valuenow')).toBe('63')
    // The spoken value is exactly the visible "left" text, and it follows it.
    expect(bar.getAttribute('aria-valuetext')).toBe(text('now-left'))
    expect(host.querySelector<HTMLElement>('.progress-fill')?.style.width).toBe('62.5%')
    expect(host.querySelector<HTMLElement>('.now-card')?.style.getPropertyValue('--block-color')).toBe('var(--cat-blue)')
    expect(text('now-next')).toMatch(/^Next · 11:00\sAM · Free until 10:00\sPM$/)
  })

  it('names tomorrow and formats hours during an overnight block', async () => {
    const { text } = await render('2026-10-21T23:00:00Z')
    expect(text('now-title')).toBe('Sleep')
    // A whole number of hours reads "7 h", never "7 h 0 min".
    expect(text('now-left')).toBe('7 h left')
    expect(text('now-next')).toMatch(/^Next · Tomorrow, 9:00\sAM · Deep work$/)
  })

  it('in a gap says Free, how long it lasts and until when, without a progress bar (check 13)', async () => {
    const { host, text } = await render('2026-10-24T12:00:00Z')
    expect(text('now-title')).toBe('Free')
    expect(text('now-eyebrow')).toBe('Now')
    expect(text('now-left')).toBe('10 h left')
    expect(text('now-until')).toMatch(/^until 10:00\sPM$/)
    expect(host.querySelector('[role="progressbar"]')).toBeNull()
    expect(host.querySelector('[data-testid="now-do"]')).toBeNull()
    expect(text('now-next')).toMatch(/^Next · 10:00\sPM · Sleep$/)
    expect(text('now-card')).not.toContain('Free time')
  })

  it('does not ask how a block went while most of it is still ahead', async () => {
    const { host } = await render('2026-10-21T10:15:00Z')
    expect(host.querySelector('[data-testid="now-do"]')).toBeNull()
    expect(host.querySelector('[role="progressbar"]')).not.toBeNull()
  })

  it('asks with three labelled buttons in the last ten minutes, and not a minute earlier', async () => {
    const early = await render('2026-10-21T10:49:30Z')
    expect(early.host.querySelector('[data-testid="now-do"]')).toBeNull()
    unmount()
    const { host, text } = await render('2026-10-21T10:50:00Z')
    expect(text('now-ask')).toBe('How did it go?')
    expect(buttons(host)).toEqual(['Done', 'Partly', 'No'])
  })

  it('records Done, No, or the minutes of Partly for the block', async () => {
    const onRecord = vi.fn()
    const { host } = await render('2026-10-21T10:55:00Z', { onRecord })
    host.querySelector<HTMLButtonElement>('[data-testid="answer-done"]')!.click()
    expect(onRecord).toHaveBeenLastCalledWith(expect.objectContaining({ blockId: 'deep', title: 'Deep work' }), 'done', undefined)
    host.querySelector<HTMLButtonElement>('[data-testid="answer-skipped"]')!.click()
    expect(onRecord).toHaveBeenLastCalledWith(expect.objectContaining({ blockId: 'deep' }), 'skipped', undefined)
    host.querySelector<HTMLButtonElement>('[data-testid="answer-partial"]')!.click()
    await nextTick()
    const input = host.querySelector<HTMLInputElement>('[data-testid="now-minutes"] input')!
    expect(input.value).toBe('60')
    input.value = '45'
    input.dispatchEvent(new Event('input'))
    host.querySelector<HTMLFormElement>('[data-testid="now-minutes"]')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(onRecord).toHaveBeenLastCalledWith(expect.objectContaining({ blockId: 'deep' }), 'partial', 45)
  })

  it('keeps showing an answer given mid-block as one line that can be changed', async () => {
    const answered = plannerDocument({
      blocks: [deepWork, sleep],
      actuals: [{
        date: '2026-10-21', blockId: 'deep', categoryId: 'work', plannedStartAt: '2026-10-21T09:00:00.000Z',
        plannedEndAt: '2026-10-21T11:00:00.000Z', plannedMinutes: 120, status: 'partial', actualMinutes: 30,
      }],
    })
    const { host, text } = await render('2026-10-21T10:15:00Z', {}, answered)
    expect(text('now-answered')).toBe('Partly · Change')
    expect(host.querySelector('[data-testid="answer-done"]')).toBeNull()
    host.querySelector<HTMLButtonElement>('[data-testid="now-answered"]')!.click()
    await nextTick()
    expect(buttons(host)).toEqual(['Done', 'Partly', 'No'])
  })

  it('does not ask about a block that started before the plan existed', async () => {
    const { host, text } = await render('2026-10-21T10:55:00Z', {}, document, { since: null })
    expect(host.querySelector('[data-testid="now-do"]')).toBeNull()
    expect(text('now-title')).toBe('Deep work')
  })

  it('says Read-only in place of the buttons when the tab cannot write', async () => {
    const { host, text } = await render('2026-10-21T10:55:00Z', { writable: false })
    expect(text('now-read-only')).toBe('Read-only in this tab')
    expect(host.querySelector('[data-testid="answer-done"]')).toBeNull()
  })

  it('offers the day wrap-up link in place of the question late in the evening', async () => {
    const { host, text } = await render('2026-10-21T23:30:00Z', {}, document, { closeDayOpen: true })
    const link = host.querySelector<HTMLAnchorElement>('[data-testid="now-close-day"]')!
    expect(link.getAttribute('href')).toBe('#/checkin')
    expect(link.textContent?.trim()).toBe('Day wrap-up')
    expect(text('now-title')).toBe('Sleep')
  })

  it('agrees the Spanish article with the hour the free time ends at', async () => {
    const early = plannerDocument({ blocks: [{ id: 'early', categoryId: 'work', title: 'Early', days: [3], start: 60, end: 120 }] })
    const { text } = await render('2026-10-21T00:10:00Z', {}, early)
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(text('now-until')?.replace(/\s/g, ' ')).toMatch(/^hasta la 1:00/)
  })

  it('names no end for the free time when the next block starts on another day', async () => {
    const onlyWork = plannerDocument({ blocks: [deepWork] })
    const { host, text } = await render('2026-10-21T12:00:00Z', {}, onlyWork)
    expect(text('now-title')).toBe('Free')
    expect(host.querySelector('[data-testid="now-left"]')).toBeNull()
    expect(text('now-next')).toMatch(/^Next · Tomorrow, 9:00\sAM · Deep work$/)
  })

  it('writes exactly one hour in the shared duration format, without "0 min"', async () => {
    const { text } = await render('2026-10-21T10:00:00Z')
    expect(text('now-left')).toBe('1 h left')
  })

  it('keeps the progress bar between empty and full', async () => {
    const state = nowStateFor(document, '2026-10-21T10:15:00Z')
    const fill = async (progress: number) => {
      const mounted = await mountForTest(NowCard, { state: { ...state, progress }, categories: document.categories, writable: true, today: '2026-10-21', timeZone: 'UTC' })
      unmount = mounted.unmount
      const width = mounted.host.querySelector<HTMLElement>('.progress-fill')!.style.width
      mounted.unmount()
      return width
    }
    expect([await fill(1.7), await fill(-0.3)]).toEqual(['100%', '0%'])
  })
})

// The next item is replaced by one with a given title, to exercise how long titles fit.
function nextOverride(title: string) {
  return { state: { ...nowStateFor(document, '2026-10-21T10:15:00Z'), next: { kind: 'item' as const, title, start: '2026-10-21T12:00:00Z' } } }
}

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
  const { host } = await render('2026-10-21T10:15:00Z', nextOverride(title))
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
  const { host } = await render('2026-10-21T10:15:00Z', nextOverride(word))
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
  const { host } = await render('2026-10-21T10:15:00Z', nextOverride('Donaudampfschifffahrtsgesellschaft Jahresbericht'))
  await nextTick()
  const label = host.querySelector('.now-next-title')!
  expect(visible(label)).toBe('Donaudampfschifffahrtsgesellschaft…')
  expect(accessibleText(label)).toBe('Donaudampfschifffahrtsgesellschaft Jahresbericht')
})

it('draws the whole title, broken anywhere and cut by its lines, when no hyphenation fits', async () => {
  modelLayout(() => 157)
  const word = 'Donaudampfschifffahrtsgesellschaftskapitaensmuetzenhersteller'
  const { host } = await render('2026-10-21T10:15:00Z', nextOverride(word))
  await nextTick()
  const label = host.querySelector('.now-next-title') as HTMLElement
  expect(visible(label)).toBe(word)
  expect(label.classList.contains('whole-word-anywhere')).toBe(true)
  expect(label.style.maxHeight).toBe('2lh')
})
