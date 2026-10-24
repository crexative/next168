import { afterEach, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import { mountForTest } from '@/features/week/mountForTest'
import { plannerDocument } from '@/features/week/testDocument'
import { nextTick } from 'vue'
import FreeHoursBadge from './FreeHoursBadge.vue'

let unmount = () => undefined as void
afterEach(() => { unmount(); i18n.global.locale.value = 'en' })

describe('FreeHoursBadge', () => {
  it('names the free hours, the last day of the week and the 168 in Spanish', async () => {
    const mounted = await mountForTest(FreeHoursBadge, { document: plannerDocument(), now: new Date('2026-10-26T00:00:00Z') })
    unmount = mounted.unmount
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(mounted.host.querySelector('[data-testid="free-hours"]')?.textContent?.trim()).toBe('Quedan 168 h libres de aquí al domingo · de 168')
  })

  it('shows whole hours, never a fraction, in every language', async () => {
    // 109 h 45 min are free from Wednesday 10:15 to Monday 00:00.
    const mounted = await mountForTest(FreeHoursBadge, { document: plannerDocument(), now: new Date('2026-10-21T10:15:00Z') })
    unmount = mounted.unmount
    expect(mounted.host.textContent).toContain('110 h free from now to Sunday · of 168')
    i18n.global.locale.value = 'de'
    await nextTick()
    expect(mounted.host.textContent).toContain('Noch 110 Std. frei bis Sonntag · von 168')
  })
})
