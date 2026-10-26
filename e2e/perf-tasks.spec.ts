import { expect, test, type Browser } from '@playwright/test'
import { V2_KEY, onlyProject } from './fixtures'
import { PERF_NOW, perfCase } from '../src/core/__fixtures__/schedulingPerf'

// P0 spec §4 A7: time to usable, populated Tasks content on a phone-sized Chromium with 4x CPU throttling. The
// planner is the typical fixture of the core benchmark, seeded through the one-time import key. Measured from
// navigation to the first placed task; then a raw tap on the add field (no actionability waits, which would absorb a
// busy main thread) and, in the page, the time from that touch to the field taking the focus. A loaded machine gets
// up to three attempts; the best one is compared with the budget, and every attempt is printed for the record.

const CPU_THROTTLE = 4
const ATTEMPTS = 3
// Budgets per machine (P0 spec §4 A6/A7: CI gates on operation counts; its wall-time budget is set from the first
// recorded CI run). The reference machine (Apple M2) keeps the spec's budgets, about 2x the measured prototype. On CI
// (GitHub's Ubuntu runner, `CI` set) the first run of the P0 code measured 1,656 ms at 200 tasks and 4,095 ms at
// 1,000 (actions run 40233224227, candidate 8eb4064); the budgets give it about 2x headroom and still fail the
// pre-P0 code by far: it showed nothing within 120 s at either size.
const ON_CI = Boolean(process.env.CI)
const CASES = [
  { tasks: 200, populatedBudgetMs: ON_CI ? 3000 : 1500 },
  { tasks: 1000, populatedBudgetMs: ON_CI ? 8000 : 3000 },
] as const
const FIRST_TAP_BUDGET_MS = 300

test.beforeEach(onlyProject('phone'))
// One case at a time, so the two never compete for the CPU; a failing case does not skip the other.
test.describe.configure({ mode: 'default' })

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

interface Attempt { populatedMs?: number; firstTapMs?: number; warningCards?: number }

async function attempt(browser: Browser, baseURL: string, tasks: number, budgetMs: number): Promise<Attempt> {
  const { document } = perfCase('typical', tasks)
  const context = await browser.newContext({ baseURL, viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, serviceWorkers: 'block', timezoneId: 'America/Bogota', locale: 'es-CO' })
  try {
    const page = await context.newPage()
    await page.clock.install({ time: PERF_NOW })
    const session = await context.newCDPSession(page)
    await session.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE })
    await page.addInitScript(([key, raw]) => {
      if (sessionStorage.getItem('perf-seeded')) return
      localStorage.setItem(key!, raw!)
      localStorage.setItem('next168-language', 'es')
      sessionStorage.setItem('perf-seeded', '1')
    }, [V2_KEY, JSON.stringify(document)])
    await page.addInitScript(() => {
      const marks = window as unknown as { tapDownAt?: number; tapFocusAt?: number }
      addEventListener('pointerdown', (event) => { if (event.isTrusted && marks.tapDownAt === undefined) marks.tapDownAt = event.timeStamp }, true)
      addEventListener('focusin', (event) => { if ((event.target as Element).matches('form.add input[type=text]') && marks.tapFocusAt === undefined) marks.tapFocusAt = performance.now() }, true)
    })
    const start = Date.now()
    // Twice the budget: past that the attempt has failed anyway (the base commit shows nothing for minutes). The
    // deadline is kept here, because a renderer stuck in a long task does not answer Playwright's own timeouts.
    const shown = page.goto('./#/tasks', { waitUntil: 'commit' }).then(() => page.getByTestId('placed-task').first().waitFor({ state: 'visible', timeout: 0 })).then(() => true, () => false)
    if (!await Promise.race([shown, delay(budgetMs * 2).then(() => false)])) return {}
    const populatedMs = Date.now() - start
    const field = page.locator('form.add input[type=text]')
    const box = (await field.boundingBox())!
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2)
    await expect(field).toBeFocused()
    const firstTapMs = await page.evaluate(() => {
      const marks = window as unknown as { tapDownAt: number; tapFocusAt: number }
      return Math.round(marks.tapFocusAt - marks.tapDownAt)
    })
    return { populatedMs, firstTapMs, warningCards: await page.locator('li.warning').count() }
  } finally {
    // A page still busy placing tasks may never close gracefully; the browser goes with the worker in any case.
    await Promise.race([context.close(), delay(5_000)])
  }
}

for (const { tasks, populatedBudgetMs } of CASES) {
  test(`Tasks with ${tasks} open tasks is usable within ${populatedBudgetMs} ms at ${CPU_THROTTLE}x CPU`, async ({ browser, baseURL }) => {
    test.setTimeout(ATTEMPTS * populatedBudgetMs * 2 + 120_000)
    const attempts: Attempt[] = []
    for (let i = 0; i < ATTEMPTS; i++) {
      const result = await attempt(browser, baseURL!, tasks, populatedBudgetMs)
      attempts.push(result)
      console.info(`[perf-tasks] tasks=${tasks} cpu=${CPU_THROTTLE}x attempt=${i + 1} populatedMs=${result.populatedMs ?? `none within ${populatedBudgetMs * 2}`} firstTapMs=${result.firstTapMs ?? '-'} warningCards=${result.warningCards ?? '-'}`)
      // Only a slow attempt is tried again: no content at all is not noise.
      if (result.populatedMs === undefined || (result.populatedMs <= populatedBudgetMs && result.firstTapMs! <= FIRST_TAP_BUDGET_MS)) break
    }
    const shown = attempts.filter((result) => result.populatedMs !== undefined)
    expect(shown.length, `no content within ${populatedBudgetMs * 2} ms in ${attempts.length} attempts`).toBeGreaterThan(0)
    expect(Math.min(...shown.map((result) => result.populatedMs!))).toBeLessThanOrEqual(populatedBudgetMs)
    expect(Math.min(...shown.map((result) => result.firstTapMs!))).toBeLessThanOrEqual(FIRST_TAP_BUDGET_MS)
  })
}
