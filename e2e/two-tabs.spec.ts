import { expect, test } from '@playwright/test'
import { V2_KEY, onlyProject } from './fixtures'

declare global {
  interface Window {
    __next168Test: {
      setTimeZone(timeZone: string): Promise<{ ok: true } | { ok: false; reason: string }>
      revision(): number | null
      timeZone(): string | null
    }
  }
}

test.beforeEach(onlyProject('desktop'))

test('two tabs committing from the same revision: exactly one wins, no lost update', async ({ context }) => {
  const first = await context.newPage()
  const second = await context.newPage()
  for (const page of [first, second]) {
    await page.goto('./')
    await page.waitForFunction(() => window.__next168Test?.revision() === 0)
  }

  const [resultFirst, resultSecond] = await Promise.all([
    first.evaluate(() => window.__next168Test.setTimeZone('Europe/Berlin')),
    second.evaluate(() => window.__next168Test.setTimeZone('America/Bogota')),
  ])

  const outcomes = [resultFirst, resultSecond]
  expect(outcomes.filter((result) => result.ok)).toHaveLength(1)
  const loser = outcomes.find((result) => !result.ok)
  expect(loser).toEqual({ ok: false, reason: 'conflict' })

  const winnerZone = resultFirst.ok ? 'Europe/Berlin' : 'America/Bogota'
  const stored = JSON.parse(await first.evaluate((key) => window.localStorage.getItem(key)!, V2_KEY))
  expect(stored.revision).toBe(1)
  expect(stored.settings.timeZone).toBe(winnerZone)

  for (const page of [first, second]) {
    await expect.poll(() => page.evaluate(() => window.__next168Test.revision())).toBe(1)
    expect(await page.evaluate(() => window.__next168Test.timeZone())).toBe(winnerZone)
  }
})
