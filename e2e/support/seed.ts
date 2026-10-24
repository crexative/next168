import type { Page } from '@playwright/test'
import { V2_KEY } from '../fixtures'

// An empty but already onboarded v2 document, so specs that do not test first-run
// onboarding are not covered by its sheet (which also scales #app while open).
export function onboardedDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    workspaceId: 'ws-e2e-onboarded',
    revision: 1,
    updatedAt: '2026-10-20T10:00:00.000Z',
    settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [], blocks: [], tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
    ...overrides,
  }
}

export async function seedOnboarded(page: Page, overrides: Record<string, unknown> = {}): Promise<void> {
  const value = JSON.stringify(onboardedDocument(overrides))
  await page.addInitScript(([key, raw]) => {
    if (!window.localStorage.getItem(key!)) window.localStorage.setItem(key!, raw!)
  }, [V2_KEY, value])
}
