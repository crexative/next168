import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { i18n } from '@/i18n'
import { BrowserPlannerRepository } from '@/repositories/BrowserPlannerRepository'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import * as downloads from './preUpgradeCopy'
import PreUpgradeCopy from './PreUpgradeCopy.vue'

let mounted: Mounted | undefined
afterEach(() => { mounted?.unmount(); vi.restoreAllMocks(); i18n.global.locale.value = 'en' })

it.each([
  [6000, false, '6 KB'], [1_500_000, false, '1.5 MB'], [26_500_000, true, '27 MB'],
])('renders the copy size with its own unit (%i bytes)', async (bytes, tooLarge, expected) => {
  vi.spyOn(BrowserPlannerRepository.prototype, 'preUpgradeCopy').mockResolvedValue({
    capturedAt: '2026-10-24T12:00:00Z', fromVersion: 1, raw: { meta: {} },
    calendarSourceTexts: {}, calendarsComplete: true, portableHash: null,
  })
  vi.spyOn(downloads, 'preUpgradeFiles').mockResolvedValue({
    capturedAt: '2026-10-24T12:00:00Z', raw: { fileName: 'raw.json', json: '{}', bytes: 2 },
    bundle: { fileName: 'backup.json', json: '{}', bytes, tooLarge },
  })
  mounted = await mountWithPlanner(PreUpgradeCopy)
  const selector = tooLarge ? '[data-testid=pre-upgrade-too-large]' : '[data-testid=pre-upgrade-size]'
  await vi.waitFor(() => expect(mounted!.host.querySelector(selector)?.textContent).toContain(expected))
  expect(mounted.host.querySelector(selector)?.textContent).not.toContain(`${expected} MB`)
  if (bytes === 1_500_000) {
    i18n.global.locale.value = 'es'
    await nextTick()
    expect(mounted.host.querySelector(selector)?.textContent).toBe('1,5 MB')
    i18n.global.locale.value = 'fr'
    await nextTick()
    expect(mounted.host.querySelector(selector)?.textContent).toBe('1,5\u202fMo')
  }
})
