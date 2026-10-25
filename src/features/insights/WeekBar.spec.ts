import { afterEach, describe, expect, it } from 'vitest'
import { createApp, type App } from 'vue'
import { i18n } from '@/i18n'
import type { Category } from '@/core/model'
import WeekBar from './WeekBar.vue'

let app: App | undefined
let host: HTMLElement | undefined

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = undefined
  host = undefined
  i18n.global.locale.value = 'en'
})

describe('WeekBar unassigned hours', () => {
  it.each([
    { plannedMinutes: 111.5 * 60, assigned: 112, unassigned: 56 },
    { plannedMinutes: 167.5 * 60, assigned: 168, unassigned: 0 },
    { plannedMinutes: 0.5 * 60, assigned: 1, unassigned: 167 },
  ])('agrees in the headline, legend and accessible segment at $plannedMinutes planned minutes', ({ plannedMinutes, assigned, unassigned }) => {
    const categories: Category[] = [{ id: 'work', name: 'Work', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
    i18n.global.locale.value = 'en'
    host = document.createElement('div')
    document.body.appendChild(host)
    app = createApp(WeekBar, { categories, plannedMinutes: { work: plannedMinutes } }).use(i18n)
    app.mount(host)

    const headline = host.querySelector('[data-testid="capacity-available"]')!.textContent
    const legendDuration = host.querySelector('[data-testid="legend-available"] .t-secondary')!.textContent
    expect(headline).toBe(`${assigned} h assigned\u00a0· ${unassigned} h unassigned`)
    expect(legendDuration).toBe(`${unassigned} h`)
    expect(headline).toContain(`${legendDuration} unassigned`)
    expect(host.querySelector('[data-segment="available"]')!.getAttribute('aria-label')).toBe(`Unassigned: ${unassigned} h`)
    expect(assigned + unassigned).toBe(168)
  })
})
