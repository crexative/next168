import { expect, test } from '@playwright/test'
import { onlyProject } from './fixtures'
import { installTapCounter, tapCount } from './support/tapCounter'

// Self-test of the tap-budget counter (P0 spec §5.1) on a static page served by the test itself.
const PAGE = 'http://tap-counter.test/'
const HTML = '<!doctype html><meta name="viewport" content="width=device-width"><input data-testid="field"><button data-testid="button">Go</button>'

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true })
test.beforeEach(onlyProject('phone'))
test.beforeEach(async ({ page }) => {
  await page.route(PAGE, (route) => route.fulfill({ contentType: 'text/html', body: HTML }))
  await installTapCounter(page)
  await page.goto(PAGE)
})

test('a tap, typing "a b c" and Enter count 2 actions', async ({ page }) => {
  await page.getByTestId('field').tap()
  await page.keyboard.type('a b c')
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('field')).toHaveValue('a b c')
  expect(await tapCount(page)).toBe(2)
})

test('a programmatic click counts nothing', async ({ page }) => {
  await page.evaluate(() => (document.querySelector('[data-testid=button]') as HTMLButtonElement).click())
  expect(await tapCount(page)).toBe(0)
})

test('a Space on a button counts 1 action', async ({ page }) => {
  await page.evaluate(() => (document.querySelector('[data-testid=button]') as HTMLButtonElement).focus())
  await page.keyboard.press(' ')
  expect(await tapCount(page)).toBe(1)
})
