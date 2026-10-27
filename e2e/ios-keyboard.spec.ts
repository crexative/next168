import { expect, test, type Page } from '@playwright/test'
import { storedPlanner, storedRecord } from './support/indexedDb'
import { live, onScreen, primary, setup, start, storedDoc, tap } from './support/setupGuided'
import { addFromMenu } from './support/week'

// P0 findings of the iPhone UX review: iOS shrinks and pans only the visual viewport when the keyboard opens. The fake
// below gives the app that behaviour (a real keyboard cannot be driven here): __keyboard(height, offsetTop).
test.use({ locale: 'es-CO', timezoneId: 'America/Bogota', launchOptions: { args: ['--disable-features=WebGPU'] } })
test.beforeEach(({}, testInfo) => { test.skip(!['phone', 'webkit-phone'].includes(testInfo.project.name), 'a phone-sized check') })

const SIZE = { width: 375, height: 812 }
const SLEEP = { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } }
const EXERCISE = { id: 'c-ex', name: 'Ejercicio', colorKey: 'green', icon: '🏃', goal: { type: 'min', hoursPerWeek: 3 } }
const EDUCATION = { id: 'c-edu', name: 'Educación', colorKey: 'orange', icon: '📚', goal: { type: 'none', hoursPerWeek: 0 } }
const SLEEP_BLOCK = { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sueño', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 }
const EXERCISE_BLOCK = { id: 'b-ex', categoryId: 'c-ex', title: 'Ejercicio', days: [1, 3, 5], start: 1080, end: 1140 }
const planned = () => storedDoc({ categories: [SLEEP, EXERCISE, EDUCATION], blocks: [SLEEP_BLOCK, EXERCISE_BLOCK], tasks: [] })

declare global {
  interface Window { __keyboard: (height: number, offsetTop: number) => void; __scrollIntoViewCalls: number }
}

async function startOnPhone(page: Page): Promise<void> {
  await start(page, { document: planned(), size: SIZE })
  await page.addInitScript(() => {
    const target = new EventTarget()
    const state = { height: window.innerHeight, offsetTop: 0 }
    Object.defineProperties(target, {
      height: { get: () => state.height }, width: { get: () => window.innerWidth }, offsetTop: { get: () => state.offsetTop },
      offsetLeft: { get: () => 0 }, pageTop: { get: () => window.scrollY + state.offsetTop }, pageLeft: { get: () => 0 }, scale: { get: () => 1 },
    })
    Object.defineProperty(window, 'visualViewport', { get: () => target, configurable: true })
    window.__keyboard = (height, offsetTop) => {
      state.height = height
      state.offsetTop = offsetTop
      target.dispatchEvent(new Event('resize'))
      target.dispatchEvent(new Event('scroll'))
    }
    window.__scrollIntoViewCalls = 0
    const original = Element.prototype.scrollIntoView
    Element.prototype.scrollIntoView = function (...args: Parameters<Element['scrollIntoView']>) {
      window.__scrollIntoViewCalls += 1
      return original.apply(this, args)
    }
  })
}

async function openCategoryAdd(page: Page): Promise<void> {
  await page.goto('./#/settings')
  await page.getByRole('button', { name: 'Añadir categoría' }).click()
  await onScreen(page, 'more')
}

async function openOtherField(page: Page) {
  await tap(page, 'Otra cosa')
  const field = live(page).getByTestId('more-other-name')
  await expect(field).toBeFocused()
  return field
}

async function keyboard(page: Page, height: number, offsetTop: number): Promise<void> {
  await page.evaluate(([h, top]) => window.__keyboard(h!, top!), [height, offsetTop])
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
}

async function frameBox(page: Page): Promise<{ top: number; bottom: number; height: number }> {
  return page.evaluate(() => {
    const rect = document.querySelector('.setup-frame')!.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, height: rect.height }
  })
}

test('P0-1 @smoke: the setup frame follows the visual viewport when the keyboard opens and pans it', async ({ page }) => {
  await startOnPhone(page)
  await openCategoryAdd(page)
  await openOtherField(page)
  await keyboard(page, 476, 152)
  const panned = await frameBox(page)
  expect(Math.abs(panned.top - 152)).toBeLessThanOrEqual(1)
  expect(Math.abs(panned.bottom - 628)).toBeLessThanOrEqual(1)
  // What the person sees at the bottom of the visible area is the frame, not the page behind it.
  expect(await page.evaluate(() => document.elementFromPoint(187, 622)?.closest('.setup-frame') !== null)).toBe(true)
  expect(await page.evaluate(() => document.elementFromPoint(187, 160)?.closest('.setup-frame') !== null)).toBe(true)
  await keyboard(page, 812, 0)
  const closed = await frameBox(page)
  expect(Math.abs(closed.top)).toBeLessThanOrEqual(1)
  expect(Math.abs(closed.height - 812)).toBeLessThanOrEqual(1)
})

test('P0-2 @smoke: the page behind the open frame does not scroll, and keeps its place when the frame closes', async ({ page }, testInfo) => {
  await startOnPhone(page)
  await page.goto('./#/week')
  await expect(page.getByRole('heading', { level: 1, name: 'Semana' })).toBeVisible()
  await page.evaluate(() => {
    const spacer = document.createElement('div')
    spacer.id = 'test-spacer'
    spacer.style.cssText = 'height:2400px;pointer-events:none'
    document.getElementById('app')!.append(spacer)
    window.scrollTo({ top: 150, behavior: 'instant' })
  })
  await page.waitForTimeout(200)
  const scrolled = await page.evaluate(() => window.scrollY)
  expect(scrolled).toBeGreaterThan(0)
  await addFromMenu(page, 'Rutina')
  await onScreen(page, 'more')
  await page.mouse.move(187, 20)
  // Mobile WebKit cannot synthesize a wheel; the keyboard scrolls the page in every engine.
  if (testInfo.project.name !== 'webkit-phone') await page.mouse.wheel(0, 400)
  await page.locator('.setup-close').focus()
  await page.keyboard.press('PageDown')
  await page.keyboard.press('End')
  await page.evaluate(() => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))))
  expect(await page.evaluate(() => window.scrollY)).toBe(scrolled)
  await page.locator('.setup-close').click()
  await expect(setup(page)).toHaveCount(0)
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(scrolled)
  expect(await page.evaluate(() => document.documentElement.classList.contains('page-locked'))).toBe(false)
})

test('P0-3 @smoke: focusing a field never scrolls the viewport, and the field stays above the keyboard', async ({ page }) => {
  await startOnPhone(page)
  await openCategoryAdd(page)
  const field = await openOtherField(page)
  await keyboard(page, 476, 0)
  expect(await page.evaluate(() => window.__scrollIntoViewCalls)).toBe(0)
  const geometry = await page.evaluate(() => {
    const box = document.querySelector('[data-testid=more-other-name]')!.getBoundingClientRect()
    return { top: box.top, bottom: box.bottom, barBottom: document.querySelector('.setup-frame .bar')!.getBoundingClientRect().bottom }
  })
  expect(geometry.top).toBeGreaterThanOrEqual(geometry.barBottom - 1)
  expect(geometry.bottom).toBeLessThanOrEqual(476 + 1)
  await expect(field).toBeVisible()
})

test.describe('P0-4: a typed name that is already an activity is never a silent duplicate', () => {
  test('Ajustes › Añadir categoría › "ejercicio " adds a time to Ejercicio by default', async ({ page }) => {
    await startOnPhone(page)
    await page.goto('./')
    await expect.poll(() => storedRecord(page, 'document')).not.toBeNull()
    const before = await storedPlanner<{ categories: unknown[]; blocks: unknown[] }>(page)
    await openCategoryAdd(page)
    await tap(page, 'Otra cosa')
    await live(page).getByTestId('more-other-name').fill('ejercicio ')
    await expect(live(page).getByTestId('same-name-note')).toHaveText('Ya tienes «Ejercicio». Se añadirá como otro horario.')
    await expect(live(page).getByTestId('more-other-add')).toHaveText('Añadir horario')
    await live(page).getByTestId('more-other-add').click()
    await expect(setup(page)).toHaveAttribute('data-screen', /^extra:/)
    await tap(page, 'Enviar respuesta')
    await tap(page, 'No, eso es todo')
    await onScreen(page, 'summary')
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    const after = await storedPlanner<{ categories: { name: string }[]; blocks: unknown[] }>(page)
    expect(after.categories.filter((category) => category.name.normalize('NFD').replace(/\p{M}/gu, '').trim().toLowerCase() === 'ejercicio')).toHaveLength(1)
    expect(after.categories).toHaveLength(before.categories.length)
    expect(after.blocks).toHaveLength(before.blocks.length + 1)
  })

  test('accents do not hide it ("educacion"), and "Crear otra actividad" is the explicit way to make a second one', async ({ page }) => {
    await startOnPhone(page)
    await page.goto('./')
    await expect.poll(() => storedRecord(page, 'document')).not.toBeNull()
    await openCategoryAdd(page)
    await tap(page, 'Otra cosa')
    await live(page).getByTestId('more-other-name').fill('educacion')
    await expect(live(page).getByTestId('same-name-note')).toHaveText('Ya tienes «Educación». Se añadirá como otro horario.')
    await live(page).getByTestId('more-other-new').click()
    await expect(setup(page)).toHaveAttribute('data-screen', /^extra:/)
    await tap(page, 'Enviar respuesta')
    await tap(page, 'No, eso es todo')
    await onScreen(page, 'summary')
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    const after = await storedPlanner<{ categories: { name: string }[] }>(page)
    expect(after.categories.map((category) => category.name)).toEqual(['Sueño', 'Ejercicio', 'Educación', 'educacion'])
  })

  test('the summary\'s "Añadir algo más" asks too when the name matches', async ({ page }) => {
    await startOnPhone(page)
    await page.goto('./')
    await expect.poll(() => storedRecord(page, 'document')).not.toBeNull()
    await openCategoryAdd(page)
    await tap(page, 'Otra cosa')
    await live(page).getByTestId('more-other-name').fill('Lectura')
    await tap(page, 'Añadir')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'No, eso es todo')
    await onScreen(page, 'summary')
    await live(page).getByTestId('summary-add').click()
    await live(page).getByTestId('card-name').fill('EJERCICIO')
    await expect(live(page).getByTestId('same-name')).toContainText('Ya tienes «Ejercicio»')
    await live(page).getByTestId('same-name-add-time').click()
    await expect(live(page).getByTestId('same-name')).toHaveCount(0)
  })
})
