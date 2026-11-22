import { expect, type Page } from '@playwright/test'

// A conversation (ConversationFrame) rises 24 px in as it opens. Vue puts its entry class on in one frame and starts the
// transition in the next, so in between document.getAnimations() is empty while the frame is still low: waiting for
// no running animation alone can measure it there (CI of #61). Measure the frame, or anything against the screen,
// after this.
export async function frameSettled(page: Page): Promise<void> {
  const frame = page.locator('.setup-frame')
  await expect(frame).toBeVisible()
  await expect(frame).not.toHaveClass(/setup-frame-enter/)
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
}
