import { chromium, expect, test, type BrowserContext, type Page } from '@playwright/test'
import { legacyData, LEGACY_BLOCK_COUNT, LEGACY_KEY, onlyProject, V2_KEY } from './fixtures'
import { storedRecord } from './support/indexedDb'
import { onboardedDocument } from './support/seed'

// A2: a change the app reported as saved survives SIGKILL of the whole browser (desktop stand-in for the
// Android force-stop of A1). Each session is a real Chromium process on one persistent profile.
test.beforeEach(onlyProject('desktop'))
test.describe.configure({ mode: 'parallel' })
// A killed browser cannot hand back its trace.
test.use({ trace: 'off' })
// Three cold Chromium starts per test; a loaded machine needs more than the default 30 s.
test.setTimeout(90_000)

declare global {
  interface Window {
    __next168Test: {
      setTimeZone(timeZone: string): Promise<{ ok: true } | { ok: false; reason: string }>
      revision(): number | null
      timeZone(): string | null
    }
  }
}

interface RunningBrowser { context: BrowserContext; page: Page; pid: number }

async function launch(profile: string): Promise<RunningBrowser> {
  const context = await chromium.launchPersistentContext(profile, { headless: true, args: ['--hide-crash-restore-bubble'] })
  // The browser process Playwright started for this profile, as Chromium itself reports it.
  const session = await context.browser()!.newBrowserCDPSession()
  const { processInfo } = await session.send('SystemInfo.getProcessInfo') as { processInfo: { type: string; id: number }[] }
  const pid = processInfo.find((info) => info.type === 'browser')?.id
  if (!pid) throw new Error('could not find the browser process')
  const page = await context.newPage()
  return { context, page, pid }
}

// SIGKILL of the browser process this test launched: no unload, no orderly shutdown, no flush.
async function kill(running: RunningBrowser): Promise<void> {
  const closed = new Promise<void>((resolve) => running.context.once('close', () => resolve()))
  process.kill(running.pid, 'SIGKILL')
  await closed
}

const baseUrl = () => test.info().project.use.baseURL!

async function openApp(page: Page, hash = ''): Promise<void> {
  await page.goto(`${baseUrl()}${hash}`)
  try {
    await page.waitForFunction(() => window.__next168Test?.revision() !== null && window.__next168Test?.revision() !== undefined, null, { timeout: 30_000 })
  } catch (error) {
    const shown = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 300), error: (window.__next168Test as unknown as { error?(): unknown } | undefined)?.error?.() })).catch(() => null)
    throw new Error(`the planner did not load: ${JSON.stringify(shown)}`, { cause: error })
  }
}

for (const run of [1, 2, 3, 4, 5]) {
  test(`(a) a committed change survives SIGKILL, run ${run}`, async ({}, testInfo) => {
    const profile = testInfo.outputPath('profile')
    let running = await launch(profile)
    try {
      // Seed an onboarded v2 document on a static asset of the origin, so the app imports it on first open.
      await running.page.goto(`${baseUrl()}favicon.ico`)
      await running.page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [V2_KEY, JSON.stringify(onboardedDocument())])
      await openApp(running.page)
      expect(await running.page.evaluate(() => window.__next168Test.setTimeZone('Europe/Berlin'))).toEqual({ ok: true })
      await kill(running)
      running = await launch(profile)
      await openApp(running.page)
      expect(await running.page.evaluate(() => window.__next168Test.timeZone())).toBe('Europe/Berlin')
    } finally {
      await running.context.close().catch(() => undefined)
    }
  })

  test(`(b) the imported v1 planner survives SIGKILL, run ${run}`, async ({}, testInfo) => {
    const profile = testInfo.outputPath('profile')
    // First session: an old v1 install, flushed by Playwright's orderly close of a persistent profile.
    const first = await launch(profile)
    await first.page.goto(`${baseUrl()}favicon.ico`)
    await first.page.evaluate(([key, value]) => window.localStorage.setItem(key, value), [LEGACY_KEY, JSON.stringify(legacyData)])
    await first.context.close()
    let running = await launch(profile)
    try {
      await openApp(running.page, '#/week')
      await expect(running.page.getByTestId('block-count')).toHaveAttribute('data-count', String(LEGACY_BLOCK_COUNT))
      await kill(running)

      running = await launch(profile)
      await openApp(running.page, '#/week')
      await expect(running.page.getByTestId('block-count')).toHaveAttribute('data-count', String(LEGACY_BLOCK_COUNT))
      expect(await storedRecord(running.page, 'document')).not.toBeNull()
    } finally {
      await running.context.close().catch(() => undefined)
    }
  })
}
