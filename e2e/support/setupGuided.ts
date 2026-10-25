import { expect, type Locator, type Page } from '@playwright/test'
import { seedKey, V2_KEY } from '../fixtures'
import { storedRecord } from './indexedDb'
import { onboardedDocument } from './seed'

// Shared by the guided-setup specs: Monday 2026-10-26 10:15 in Bogotá, inside the default work range.
export const NOW = new Date('2026-10-26T15:15:00.000Z')
export const PHONE = { width: 390, height: 844 } as const
export const SMALL = { width: 320, height: 640 } as const

export type Theme = 'light' | 'dark'
export interface StartOptions {
  // A stored document (seeded as an older build's v2 data, which the app imports on its first load). None: proven-empty storage.
  document?: Record<string, unknown>
  size?: { width: number; height: number }
  theme?: Theme
  language?: string
  at?: Date
}

const ES_SETTINGS = { locale: 'es', weekStartsOn: 1, timeZone: 'America/Bogota', theme: 'system' }

export const storedDoc = (overrides: Record<string, unknown> = {}, onboardingDone = true) =>
  onboardedDocument({ workspaceId: 'ws-setup', ...overrides, settings: { ...ES_SETTINGS, onboardingDone, ...((overrides.settings as object | undefined) ?? {}) } })

export async function start(page: Page, options: StartOptions = {}): Promise<void> {
  await page.setViewportSize(options.size ?? PHONE)
  await page.emulateMedia({ colorScheme: options.theme ?? 'light' })
  await page.clock.install({ time: options.at ?? NOW })
  const language = options.language ?? 'es'
  await page.addInitScript((value) => window.localStorage.setItem('next168-language', value), language)
  if (options.document) await seedKey(page, V2_KEY, JSON.stringify(options.document))
}

export const setup = (page: Page): Locator => page.getByTestId('setup')
// The screen on show; a leaving screen stays in the DOM for a frame, hidden from assistive technology and inert.
export const live = (page: Page): Locator => page.locator('[data-testid=setup] section.screen:not([aria-hidden=true])')

export async function onScreen(page: Page, screen: string): Promise<void> {
  await expect(setup(page)).toHaveAttribute('data-screen', screen)
  await expect(page.locator('[data-testid=setup] section.screen[aria-hidden=true]')).toHaveCount(0)
}

export async function tap(page: Page, name: string): Promise<void> {
  await live(page).getByRole('button', { name, exact: true }).click()
}

export const primary = (page: Page): Locator => live(page).getByTestId('setup-primary')
export const secondary = (page: Page): Locator => live(page).getByTestId('setup-secondary')

// Every screen up to the summary, leaving each question unanswered.
export async function skipToSummary(page: Page): Promise<void> {
  for (let guard = 0; guard < 10; guard++) {
    if ((await setup(page).getAttribute('data-screen')) === 'summary') return
    const screen = await setup(page).getAttribute('data-screen')
    await secondary(page).click()
    await expect(setup(page)).not.toHaveAttribute('data-screen', screen!)
  }
  await onScreen(page, 'summary')
}

export async function bytes(page: Page): Promise<{ document: string | null; backup: string | null }> {
  return { document: await storedRecord(page, 'document'), backup: await storedRecord(page, 'backup') }
}

// Sheets move with scripted springs, not CSS animations: wait for the panel to rest and every animation to end.
export async function calm(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const panels = document.querySelectorAll<HTMLElement>('[role="dialog"]')
    const panel = panels[panels.length - 1] ?? null
    const springing = panel !== null && !/^(|none|translateY\(0px\))$/.test(panel.style.transform)
    return !springing && document.getAnimations().every((animation) => animation.playState !== 'running')
      && document.querySelectorAll('[data-testid=setup] section.screen[aria-hidden=true]').length === 0
  })
}

// Opens the guided setup from Ajustes › Categorías (always offered while the planner can be written).
export async function openFromSettings(page: Page): Promise<void> {
  await page.goto('./#/settings')
  await page.getByTestId('setup-guided-row').getByRole('button').click()
  await expect(setup(page)).toBeVisible()
}

// Keeps every commit waiting until released, by holding the app's own storage lock.
export async function holdCommitLock(page: Page): Promise<() => Promise<void>> {
  await page.evaluate(() => new Promise<void>((acquired) => {
    void navigator.locks.request('next168-commit', () => new Promise<void>((release) => {
      ;(window as unknown as { __releaseCommit: () => void }).__releaseCommit = release
      acquired()
    }))
  }))
  return () => page.evaluate(() => (window as unknown as { __releaseCommit: () => void }).__releaseCommit())
}

// Writes the planner document straight into IndexedDB, bypassing the app (another window that did not tell this one).
export async function writeStoredDocument(page: Page, document: unknown): Promise<void> {
  await page.evaluate((raw) => new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('next168')
    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const db = request.result
      const transaction = db.transaction('document', 'readwrite')
      transaction.objectStore('document').put(raw, 'current')
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onerror = () => { db.close(); reject(transaction.error) }
    }
  }), JSON.stringify(document))
}
