import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'

// The recovery screen's confirmation is the only Sheet in the shell slice, so it is the test subject.
const CORRUPT = '{"schemaVersion":2,'

async function openSheet(page: Page): Promise<void> {
  await seedKey(page, V2_KEY, CORRUPT)
  await page.goto('./')
  await page.getByRole('button', { name: 'Start with an empty planner' }).click()
  await expect(page.getByRole('dialog', { name: 'Replace the unreadable data?' })).toBeVisible()
  const dialog = page.getByRole('dialog')
  const viewport = page.viewportSize()!
  await expect.poll(async () => { const box = await dialog.boundingBox(); return box ? Math.round(box.y + box.height) : null }, { message: 'sheet settled' }).toBeLessThanOrEqual(viewport.height + 1)
  await page.waitForTimeout(500)
}

// The sheet measures release velocity from the pointer events' own timestamps. Dispatching them over the
// DevTools protocol with explicit timestamps makes the gesture speed independent of how loaded the machine is.
async function dragHandle(page: Page, distance: number, durationMs: number, steps: number): Promise<void> {
  const box = (await page.locator('.sheet-grab').boundingBox())!
  const x = box.x + box.width / 2
  const y = box.y + 8
  const client = await page.context().newCDPSession(page)
  const origin = Date.now() / 1000
  let clock = 0
  const send = (type: 'mousePressed' | 'mouseMoved' | 'mouseReleased', at: number) => client.send('Input.dispatchMouseEvent', {
    type, x, y: y + at, button: type === 'mouseMoved' && at === 0 ? 'none' : 'left', buttons: type === 'mouseReleased' ? 0 : 1,
    clickCount: type === 'mouseMoved' ? 0 : 1, pointerType: 'mouse', timestamp: origin + clock / 1000,
  })
  await send('mousePressed', 0)
  for (let step = 1; step <= steps; step += 1) {
    clock = (durationMs * step) / steps
    await send('mouseMoved', (distance * step) / steps)
  }
  await send('mouseReleased', distance)
}

test.describe('sheet', () => {
  test('focus is trapped, Escape closes and focus returns to the trigger', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'desktop')
    await openSheet(page)
    const dialog = page.getByRole('dialog')
    for (let press = 0; press < 6; press += 1) {
      await page.keyboard.press('Tab')
      expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true)
    }
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
    await expect(page.getByRole('button', { name: 'Start with an empty planner' })).toBeFocused()
  })

  test('is centered on desktop and a bottom sheet on the phone', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name === 'tablet')
    await openSheet(page)
    const box = (await page.getByRole('dialog').boundingBox())!
    const viewport = page.viewportSize()!
    if (testInfo.project.name === 'phone') expect(Math.round(box.y + box.height)).toBe(viewport.height)
    else expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThan(2)
  })

  test('a fast downward flick dismisses from a small offset', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await openSheet(page)
    await dragHandle(page, 60, 40, 2)
    await expect(page.getByRole('dialog')).toBeHidden()
  })

  test('a slow release under 40 % of the height snaps back', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await openSheet(page)
    await dragHandle(page, 50, 800, 8)
    const dialog = page.getByRole('dialog')
    const viewport = page.viewportSize()!
    await expect.poll(async () => { const box = await dialog.boundingBox(); return box ? Math.round(box.y + box.height) : null }).toBe(viewport.height)
  })

  test('with reduced motion no transform animation runs while opening', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'phone')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await seedKey(page, V2_KEY, CORRUPT)
    await page.goto('./')
    await page.getByRole('button', { name: 'Start with an empty planner' }).click()
    const transformAnimations = await page.evaluate(() => document.getAnimations().filter((animation) => {
      const effect = animation.effect as KeyframeEffect | null
      return effect?.getKeyframes().some((keyframe) => 'transform' in keyframe && keyframe.transform !== 'none')
    }).length)
    expect(transformAnimations).toBe(0)
    await expect(page.getByRole('dialog')).toBeVisible()
  })
})
