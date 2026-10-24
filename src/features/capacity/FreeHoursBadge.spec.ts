import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { mountForTest } from '@/features/week/mountForTest'
import { plannerDocument } from '@/features/week/testDocument'
import { nextTick } from 'vue'
import FreeHoursBadge from './FreeHoursBadge.vue'

let unmount = () => undefined as void
afterEach(() => { unmount(); i18n.global.locale.value = 'en' })

const badgeText = (host: HTMLElement) => host.querySelector('[data-testid="free-hours"]')?.textContent?.trim()

describe('FreeHoursBadge', () => {
  it('says the live free hours of this week and nothing else, in Spanish', async () => {
    const mounted = await mountForTest(FreeHoursBadge, { document: plannerDocument(), now: new Date('2026-10-26T00:00:00Z') })
    unmount = mounted.unmount
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(badgeText(mounted.host)).toBe('168 h libres esta semana')
  })

  it('shows whole hours, never a fraction, in every language', async () => {
    // 109 h 45 min are free from Wednesday 10:15 to Monday 00:00.
    const mounted = await mountForTest(FreeHoursBadge, { document: plannerDocument(), now: new Date('2026-10-21T10:15:00Z') })
    unmount = mounted.unmount
    expect(badgeText(mounted.host)).toBe('110 h free this week')
    for (const [language, text] of [['es', '110 h libres esta semana'], ['fr', '110 h libres cette semaine'], ['pt', '110 h livres esta semana'], ['de', '110 h frei diese Woche']] as const) {
      i18n.global.locale.value = language
      await nextTick()
      expect(badgeText(mounted.host), language).toBe(text)
    }
  })

  it('agrees in number: one hour is "libre", none or many are "libres"', async () => {
    const lastHour = await mountForTest(FreeHoursBadge, { document: plannerDocument(), now: new Date('2026-10-25T23:00:00Z') })
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(badgeText(lastHour.host)).toBe('1 h libre esta semana')
    lastHour.unmount()
    const none = await mountForTest(FreeHoursBadge, { document: plannerDocument(), now: new Date('2026-10-25T23:59:40Z') })
    unmount = none.unmount
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(badgeText(none.host)).toBe('0 h libres esta semana')
  })
})
