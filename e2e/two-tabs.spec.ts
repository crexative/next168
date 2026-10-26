import { expect, test } from '@playwright/test'
import { onlyProject } from './fixtures'
import { storedPlanner } from './support/indexedDb'

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

  // A third page holds the commit lock so both tabs capture revision 0 before either can write;
  // without it, a fast storage event could refresh one tab first and make the race sequential.
  const holder = await context.newPage()
  await holder.goto('./')
  // The holder's own app takes the same lock while it loads (an empty planner's first load runs under it): it must
  // have finished before the holder locks, or that load is a third waiter and the count below is never 2.
  await holder.waitForFunction(() => window.__next168Test?.revision() === 0)
  await holder.evaluate(() => new Promise<void>((locked) => {
    void navigator.locks.request('next168-commit', () => new Promise<void>((release) => {
      ;(window as unknown as { releaseCommitLock: () => void }).releaseCommitLock = release
      locked()
    }))
  }))
  const pending = Promise.all([
    first.evaluate(() => window.__next168Test.setTimeZone('Europe/Berlin')),
    second.evaluate(() => window.__next168Test.setTimeZone('America/Bogota')),
  ])
  await expect.poll(() => holder.evaluate(async () => (await navigator.locks.query()).pending?.length ?? 0)).toBe(2)
  await holder.evaluate(() => (window as unknown as { releaseCommitLock: () => void }).releaseCommitLock())
  const [resultFirst, resultSecond] = await pending

  const outcomes = [resultFirst, resultSecond]
  expect(outcomes.filter((result) => result.ok)).toHaveLength(1)
  const loser = outcomes.find((result) => !result.ok)
  expect(loser).toEqual({ ok: false, reason: 'conflict' })

  const winnerZone = resultFirst.ok ? 'Europe/Berlin' : 'America/Bogota'
  const stored = await storedPlanner<{ revision: number; settings: { timeZone: string } }>(first)
  expect(stored.revision).toBe(1)
  expect(stored.settings.timeZone).toBe(winnerZone)

  for (const page of [first, second]) {
    await expect.poll(() => page.evaluate(() => window.__next168Test.revision())).toBe(1)
    expect(await page.evaluate(() => window.__next168Test.timeZone())).toBe(winnerZone)
  }
})

test('a commit in one tab shows in the other within 2 s, without a reload (A9)', async ({ context }) => {
  const first = await context.newPage()
  const second = await context.newPage()
  for (const page of [first, second]) {
    await page.goto('./')
    await page.waitForFunction(() => window.__next168Test?.revision() === 0)
  }
  const navigations: string[] = []
  second.on('framenavigated', (frame) => { if (frame === second.mainFrame()) navigations.push(frame.url()) })
  expect(await first.evaluate(() => window.__next168Test.setTimeZone('Asia/Tokyo'))).toEqual({ ok: true })
  await expect.poll(() => second.evaluate(() => window.__next168Test.timeZone()), { timeout: 2000 }).toBe('Asia/Tokyo')
  expect(navigations).toEqual([])
})
