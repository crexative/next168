import { expect, test, type Page, type TestInfo } from '@playwright/test'

export const LEGACY_KEY = 'next168-data'
export const V2_KEY = 'next168-v2'

export const TABS = ['today', 'week', 'tasks', 'insights', 'settings'] as const
export type TabName = (typeof TABS)[number]

export const TAB_TITLES: Record<TabName, string> = {
  today: 'Today', week: 'Week', tasks: 'Tasks', insights: 'Insights', settings: 'Settings',
}

// Real v1 shape: block 1 repeats with a duplicate day, block 2 crosses midnight.
export const legacyData = {
  categories: [
    { id: 'c-sleep', name: 'Sleep', color: '#8b5cf6', weeklyHourLimit: 56, icon: '😴' },
    { id: 'c-work', name: 'Work', color: '#3b82f6', weeklyHourLimit: 40 },
  ],
  timeBlocks: [
    { id: 'b-1', categoryId: 'c-work', title: 'Deep work', description: 'No meetings', dayOfWeek: 1, startTime: '09:00', endTime: '13:00', durationMinutes: 240, repeatDays: [1, 2, 3] },
    { id: 'b-2', categoryId: 'c-sleep', title: 'Sleep', dayOfWeek: 0, startTime: '22:30', endTime: '06:30', durationMinutes: 480, repeatDays: [0, 1, 2, 3, 4, 5, 6] },
    { id: 'b-3', categoryId: 'c-work', title: 'Review', dayOfWeek: 5, startTime: '15:00', endTime: '16:00', durationMinutes: 60 },
  ],
}
export const LEGACY_BLOCK_COUNT = legacyData.timeBlocks.length

export async function seedLegacy(page: Page, raw: string = JSON.stringify(legacyData)): Promise<void> {
  await page.addInitScript(([key, value]) => {
    if (!window.localStorage.getItem(key!)) window.localStorage.setItem(key!, value!)
  }, [LEGACY_KEY, raw])
}

export async function seedKey(page: Page, key: string, value: string): Promise<void> {
  await page.addInitScript(([k, v]) => {
    if (!window.localStorage.getItem(k!)) window.localStorage.setItem(k!, v!)
  }, [key, value])
}

export async function storedValue(page: Page, key: string): Promise<string | null> {
  return page.evaluate((k) => window.localStorage.getItem(k), key)
}

export async function openTab(page: Page, tab: TabName, base = './'): Promise<void> {
  await page.goto(`${base}#/${tab}`)
  await expect(page.getByRole('heading', { level: 1, name: TAB_TITLES[tab] })).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

// Calendars, the AI assistant connection, the on-device model, storage protection and technical details
// live one level below Settings.
export async function openAdvanced(page: Page, base = './'): Promise<void> {
  await page.goto(`${base}#/settings/advanced`)
  await expect(page.getByRole('heading', { level: 1, name: TAB_TITLES.settings })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Integrations and advanced' })).toBeVisible()
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().length === 0)
}

export function onlyProject(name: string) {
  return ({ browserName }: { browserName: string }, testInfo: TestInfo): void => {
    test.skip(testInfo.project.name !== name, `runs only in the ${name} project, not ${browserName}`)
  }
}
