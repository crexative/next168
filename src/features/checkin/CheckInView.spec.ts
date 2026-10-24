// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId, testDocument } from '@/repositories/testSupport'
import CheckInView from './CheckInView.vue'
import { consumeSavedFlag } from './checkinFlash'

// 2026-10-24 is a Saturday; the plan sleeps every night 22:00 → 06:00 and works Monday to Friday 09:00 → 17:00.
const sleepCategory = { id: 'sleep', name: 'Sleep', colorKey: 'purple' as const, icon: '😴', goal: { type: 'none' as const, hoursPerWeek: 0 } }
const workCategory = { id: 'work', name: 'Work', colorKey: 'blue' as const, icon: '💼', goal: { type: 'max' as const, hoursPerWeek: 40 } }
const planned: PlannerDocument = {
  ...testDocument(), revision: 1, categories: [sleepCategory, workCategory],
  blocks: [
    { id: 'sleep', categoryId: 'sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1320, end: 360 },
    { id: 'work', categoryId: 'work', title: 'Work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
  ],
}

let app: App | undefined
let host: HTMLElement

async function mount(first: PlannerDocument) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const repos = createTestRepositories()
  configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const store = usePlannerStore()
  host = document.createElement('div')
  document.body.appendChild(host)
  await repos.planner.save(first, 0)
  await store.load()
  i18n.global.locale.value = 'en'
  app = createApp(CheckInView).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  return store
}

const input = (label: string) => [...host.querySelectorAll('label')].find((node) => node.textContent?.includes(label))?.querySelector('input')

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()); window.location.hash = '' })
afterEach(() => { app?.unmount(); host?.remove(); app = undefined; vi.useRealTimers(); i18n.global.locale.value = 'en' })

describe('check-in form', () => {
  it('has a back control to Today, since the check-in has no tab', async () => {
    await mount(planned)
    const back = host.querySelector<HTMLAnchorElement>('[data-testid="back-button"]')!
    expect(back.getAttribute('href')).toBe('#/today')
    expect(back.getAttribute('aria-label')).toBe('Back to Today')
    expect(host.querySelector('form')!.contains(back)).toBe(false)
  })

  it('labels both questions visibly and names the radio groups after them', async () => {
    await mount(planned)
    const groups = [...host.querySelectorAll('[role="radiogroup"]')]
    const names = groups.map((group) => host.querySelector(`#${CSS.escape(group.getAttribute('aria-labelledby')!)}`)?.textContent)
    expect(names).toEqual(['Did you exercise?', 'Stress today (1 calm – 5 high)'])
    expect(groups[0]!.querySelectorAll('[role="radio"]')).toHaveLength(3)
    expect(groups[1]!.querySelectorAll('[role="radio"]')).toHaveLength(5)
    // Nothing is picked yet, yet each row stays reachable with Tab through its first choice.
    expect(groups.map((group) => [...group.querySelectorAll('[role="radio"]')].filter((radio) => radio.getAttribute('tabindex') === '0').length)).toEqual([1, 1])
  })

  it('prefills bedtime and wake from the plan and says where they come from', async () => {
    await mount(planned)
    expect(input('Bedtime')?.value).toBe('22:00')
    expect(input('Wake-up')?.value).toBe('06:00')
    expect(host.querySelector('[data-testid="plan-hint"]')?.textContent).toContain('Times come from your plan')
  })

  it('hides "Work ended" on a day without work and fills it from the plan on a work day', async () => {
    await mount(planned)
    expect(input('Work ended')).toBeUndefined()
    const date = host.querySelector<HTMLInputElement>('input[type=date]')!
    date.value = '2026-10-23'
    date.dispatchEvent(new Event('input'))
    date.dispatchEvent(new Event('change'))
    await nextTick()
    expect(input('Work ended')?.value).toBe('17:00')
  })

  it('shows a saved check-in exactly as stored, without the plan’s times', async () => {
    await mount({ ...planned, checkIns: [{ date: '2026-10-24', bedtime: 1410, wake: 420 }] })
    expect(input('Bedtime')?.value).toBe('23:30')
    expect(input('Wake-up')?.value).toBe('07:00')
    expect(host.querySelector('[data-testid="plan-hint"]')).toBeNull()
  })

  it('saves in four taps, returns to Today and leaves the confirmation for its card', async () => {
    const store = await mount(planned)
    const radio = (group: number, index: number) => host.querySelectorAll('[role="radiogroup"]')[group]!.querySelectorAll<HTMLButtonElement>('[role="radio"]')[index]!
    radio(0, 0).click()
    radio(1, 1).click()
    await nextTick()
    host.querySelector<HTMLButtonElement>('button[type=submit]')!.click()
    await store.settled()
    expect(store.document?.checkIns).toEqual([{ date: '2026-10-24', bedtime: 1320, wake: 360, exercise: 'yes', stress: 2 }])
    expect(window.location.hash).toBe('#/today')
    expect(consumeSavedFlag()).toBe(true)
  })

  it('moves the selection with the arrow keys', async () => {
    await mount(planned)
    const first = host.querySelectorAll('[role="radiogroup"]')[0]!.querySelectorAll<HTMLButtonElement>('[role="radio"]')
    first[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))
    await nextTick()
    expect(first[0]!.getAttribute('aria-checked')).toBe('false')
    expect(first[1]!.getAttribute('aria-checked')).toBe('true')
  })
})
