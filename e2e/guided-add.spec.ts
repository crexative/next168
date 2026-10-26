import { expect, test, type Page } from '@playwright/test'
import { storedPlanner, storedRecord } from './support/indexedDb'
import { bytes, live, onScreen, primary, setup, start, storedDoc, tap, writeStoredDocument } from './support/setupGuided'
import { addFromMenu, openClassicRoutine } from './support/week'

// Adding to a week after setup with the same conversation: Week "+" › Rutina, the empty week's "Añadir una rutina" and
// Ajustes › Añadir categoría. It only ever adds; closing discards. es-CO, Monday 2026-10-26 10:15, 390x844.
test.use({ locale: 'es-CO', timezoneId: 'America/Bogota', launchOptions: { args: ['--disable-features=WebGPU'] } })
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'sizes are set per test') })

interface Doc {
  revision: number
  settings: Record<string, unknown>
  categories: { id: string; name: string; colorKey: string; icon?: string; goal: { type: string; hoursPerWeek: number } }[]
  blocks: { id: string; categoryId: string; title: string; days: number[]; start: number; end: number }[]
  tasks: unknown[]
  events: unknown[]
}
const SLEEP = { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } }
const WORK = { id: 'c-work', name: 'Trabajo', colorKey: 'blue', icon: '💼', goal: { type: 'max', hoursPerWeek: 40 } }
const SLEEP_BLOCK = { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sueño', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 }
const WORK_BLOCK = { id: 'b-work', categoryId: 'c-work', title: 'Trabajo', days: [1, 2, 3, 4, 5], start: 540, end: 1020, notes: 'Llevar el portátil' }
const TASK = { id: 't-report', title: 'Informe', categoryId: 'c-work', durationMin: 60, priority: 2, createdAt: '2026-10-20T08:00:00.000Z' }
const planned = (extra: Record<string, unknown> = {}) => storedDoc({ categories: [SLEEP, WORK], blocks: [SLEEP_BLOCK, WORK_BLOCK], tasks: [TASK], ...extra })
const CHANGED = 'Tu semana cambió en otra ventana. Te mostramos la versión actual.'
const adding = (page: Page) => page.locator('[data-testid=setup][data-mode=add]')
const reply = (page: Page, name: string) => live(page).getByRole('button', { name, exact: true })

async function stored(page: Page): Promise<Doc> {
  return storedPlanner<Doc>(page)
}

// The seeded week is imported into IndexedDB by the app after the page loads: wait for it before reading "before".
async function loaded(page: Page): Promise<void> {
  await page.goto('./')
  await expect.poll(() => storedRecord(page, 'document')).not.toBeNull()
}

async function openWeekAdd(page: Page): Promise<void> {
  await page.goto('./#/week')
  await expect(page.getByRole('heading', { level: 1, name: 'Semana' })).toBeVisible()
  await addFromMenu(page, 'Rutina')
  await onScreen(page, 'more')
}

async function openCategoryAdd(page: Page): Promise<void> {
  await page.goto('./#/settings')
  await page.getByRole('button', { name: 'Añadir categoría' }).click()
  await onScreen(page, 'more')
}

// "Otra cosa": a typed name, optionally with "Va en", added; lands on its times.
async function typeOwn(page: Page, name: string, goesIn?: string): Promise<void> {
  await tap(page, 'Otra cosa')
  await live(page).getByTestId('more-other-name').fill(name)
  if (goesIn !== undefined) await live(page).getByTestId('goes-in').selectOption({ label: goesIn })
  await tap(page, 'Añadir')
  await expect(setup(page)).toHaveAttribute('data-screen', /^extra:/)
}

// The times as offered, then "No, eso es todo" and the summary.
async function sendAndFinish(page: Page): Promise<void> {
  await tap(page, 'Enviar respuesta')
  await expect(setup(page)).toHaveAttribute('data-screen', /^more:\d+$/)
  await tap(page, 'No, eso es todo')
  await onScreen(page, 'summary')
}

test.describe('where it opens (S2-1, S2-5)', () => {
  test('S2-1: Week "+" › Rutina asks what to make time for, with no time field and no progress', async ({ page }) => {
    await start(page, { document: planned() })
    await openWeekAdd(page)
    await expect(adding(page)).toBeVisible()
    await expect(live(page).getByRole('heading', { level: 3 })).toHaveText('¿Para qué quieres hacer tiempo?')
    await expect(page.locator('[data-testid=setup] input[type=time]')).toHaveCount(0)
    await expect(page.getByTestId('setup-progress')).toHaveCount(0)
    // Adding a routine offers what the week does not have yet, then (under "Ya en tu semana") its stored categories.
    await expect(live(page).locator('.reply')).toHaveText(['Estudio', 'Ejercicio', 'Familia', 'Amigos', 'Tiempo para ti', 'Aprender', 'Sueño', 'Trabajo'])
  })

  test('S2-5: the empty week\'s "Añadir una rutina" opens the same question', async ({ page }) => {
    await start(page, { document: planned({ blocks: [], tasks: [] }) })
    await page.goto('./#/week')
    await page.getByRole('button', { name: 'Añadir una rutina' }).click()
    await onScreen(page, 'more')
    await expect(adding(page)).toBeVisible()
    await expect(live(page).getByRole('heading', { level: 3 })).toHaveText('¿Para qué quieres hacer tiempo?')
  })
})

// On a wide screen the answers sit right under their question, not at the bottom of the window.
async function questionToRepliesGap(page: Page): Promise<number> {
  return page.evaluate(() => {
    const bubble = document.querySelector('[data-testid=setup] section.screen:not([aria-hidden=true]) .exchange.is-current .bubble')!.getBoundingClientRect()
    const reply = document.querySelector('[data-testid=setup] section.screen:not([aria-hidden=true]) .reply')!.getBoundingClientRect()
    return reply.top - bubble.bottom
  })
}

test('polish 2: at 1440x900 the first question\'s replies sit right under it, with new ideas before "Ya en tu semana"', async ({ page }) => {
  await start(page, { document: planned(), size: { width: 1440, height: 900 } })
  await openWeekAdd(page)
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
  expect(await questionToRepliesGap(page)).toBeLessThan(96)
  await expect(live(page).locator('.reply').first()).toHaveText('Estudio')
  await expect(live(page).getByRole('group', { name: 'Ya en tu semana' }).locator('.reply')).toHaveText(['Sueño', 'Trabajo'])
})

test.describe('adding only (S2-2, S2-3, S2-4, S2-11)', () => {
  test('S2-2: something of one\'s own with two times is one revision that adds one category and two blocks, and says so', async ({ page }) => {
    await start(page, { document: planned() })
    await loaded(page)
    const before = await stored(page)
    await openWeekAdd(page)
    await typeOwn(page, 'Práctica de guitarra')
    await live(page).getByTestId('range-add').click()
    await sendAndFinish(page)
    // The summary says what is added (polish 1).
    await expect(live(page).getByRole('heading', { level: 3 })).toHaveText('Esto se añade a tu semana. Toca algo para cambiarlo.')
    await expect(live(page).locator('.week-title')).toHaveText('Lo que añades')
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    await expect(page.getByTestId('live-announcer')).toContainText('Añadido «Práctica de guitarra»')
    const after = await stored(page)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.categories.slice(0, 2)).toEqual(before.categories)
    expect(after.categories.map((category) => category.name)).toEqual(['Sueño', 'Trabajo', 'Práctica de guitarra'])
    const guitar = after.categories[2]!
    const added = after.blocks.slice(2)
    expect(after.blocks.slice(0, 2)).toEqual(before.blocks)
    expect(added).toHaveLength(2)
    for (const block of added) expect(block).toMatchObject({ categoryId: guitar.id, title: 'Práctica de guitarra' })
    expect([after.tasks, after.events, after.settings]).toEqual([before.tasks, before.events, before.settings])
  })

  test('S2-3: "Va en" Trabajo adds a block to Trabajo and no category; switching back to "Por su cuenta" creates one', async ({ page }) => {
    await start(page, { document: planned() })
    await loaded(page)
    const before = await stored(page)
    await openWeekAdd(page)
    await typeOwn(page, 'Reunión de equipo', 'Trabajo')
    await sendAndFinish(page)
    await expect(live(page).getByTestId('card-into')).toHaveText('en Trabajo')
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    let after = await stored(page)
    expect(after.categories).toEqual(before.categories)
    expect(after.blocks.slice(2)).toEqual([expect.objectContaining({ categoryId: 'c-work', title: 'Reunión de equipo' })])

    await openWeekAdd(page)
    await tap(page, 'Otra cosa')
    await live(page).getByTestId('more-other-name').fill('Clase de inglés')
    await live(page).getByTestId('goes-in').selectOption({ label: 'Trabajo' })
    await live(page).getByTestId('goes-in').selectOption({ label: 'Por su cuenta' })
    await tap(page, 'Añadir')
    await sendAndFinish(page)
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    after = await stored(page)
    expect(after.categories.map((category) => category.name)).toEqual(['Sueño', 'Trabajo', 'Clase de inglés'])
  })

  test('S2-3: typing "Trabajo" pre-selects it in "Va en"; "Por su cuenta" chosen then makes a new "Trabajo"', async ({ page }) => {
    await start(page, { document: planned() })
    await openWeekAdd(page)
    await tap(page, 'Otra cosa')
    await live(page).getByTestId('more-other-name').fill('trabajo ')
    await expect(live(page).getByTestId('goes-in')).toHaveValue('c-work')
    await live(page).getByTestId('goes-in').selectOption({ label: 'Por su cuenta' })
    await live(page).getByTestId('more-other-name').fill('Trabajo')
    await expect(live(page).getByTestId('goes-in')).toHaveValue('')
    await tap(page, 'Añadir')
    await sendAndFinish(page)
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    const after = await stored(page)
    expect(after.categories.map((category) => category.name)).toEqual(['Sueño', 'Trabajo', 'Trabajo'])
    expect(after.categories[2]!.id).not.toBe('c-work')
  })

  test('S2-3: with two stored "Lectura", typing "Lectura" pre-selects nothing', async ({ page }) => {
    const reading = (id: string) => ({ id, name: 'Lectura', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } })
    await start(page, { document: planned({ categories: [SLEEP, WORK, reading('c-r1'), reading('c-r2')] }) })
    await openWeekAdd(page)
    await tap(page, 'Otra cosa')
    await live(page).getByTestId('more-other-name').fill('Lectura')
    await expect(live(page).getByTestId('goes-in')).toHaveValue('')
  })

  test('S2-4: picking stored Trabajo adds one block titled Trabajo to it and leaves its block as it was', async ({ page }) => {
    await start(page, { document: planned() })
    await loaded(page)
    const before = await stored(page)
    await openWeekAdd(page)
    await tap(page, 'Trabajo')
    await expect(setup(page)).toHaveAttribute('data-screen', 'extra:into:c-work')
    await sendAndFinish(page)
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    const after = await stored(page)
    expect(after.blocks.find((block) => block.id === 'b-work')).toEqual(before.blocks.find((block) => block.id === 'b-work'))
    expect(after.blocks.slice(2)).toEqual([expect.objectContaining({ categoryId: 'c-work', title: 'Trabajo' })])
    expect(after.categories).toEqual(before.categories)
  })

  test('S2-11: an add never marks the setup as done', async ({ page }) => {
    await page.addInitScript(() => window.localStorage.setItem('next168-setup-dismissed', 'ws-setup'))
    await start(page, { document: planned({ settings: { onboardingDone: false } }) })
    await openWeekAdd(page)
    await typeOwn(page, 'Leer')
    await sendAndFinish(page)
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    const after = await stored(page)
    expect(after.categories.map((category) => category.name)).toContain('Leer')
    expect(after.settings.onboardingDone).toBe(false)
  })
})

test.describe('a category from Ajustes (S2-6, S2-7)', () => {
  test('S2-6: no stored category and no "Va en" are offered; Familia with no fixed time is one category in an unused colour', async ({ page }) => {
    await start(page, { document: planned() })
    await loaded(page)
    const before = await stored(page)
    await openCategoryAdd(page)
    await expect(reply(page, 'Trabajo')).toHaveCount(0)
    await expect(reply(page, 'Sueño')).toHaveCount(0)
    await tap(page, 'Otra cosa')
    await expect(live(page).getByTestId('goes-in')).toHaveCount(0)
    await page.keyboard.press('Escape')
    await tap(page, 'Familia')
    await onScreen(page, 'extra:family')
    await tap(page, 'Sin horario fijo')
    await tap(page, 'No, eso es todo')
    await onScreen(page, 'summary')
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    const after = await stored(page)
    expect(after.blocks).toEqual(before.blocks)
    const family = after.categories.at(-1)!
    expect(family).toMatchObject({ name: 'Familia', colorKey: 'pink' })
    expect(before.categories.map((category) => category.colorKey)).not.toContain(family.colorKey)
  })

  test('S2-6: with every colour taken it gets the least used one, and the colour can be changed in its sheet', async ({ page }) => {
    const colours = ['blue', 'green', 'orange', 'pink', 'purple', 'teal', 'yellow', 'red', 'gray']
    const categories = colours.map((colorKey, index) => ({ id: `c-${index}`, name: `Cosa ${index}`, colorKey, goal: { type: 'none', hoursPerWeek: 0 } }))
    await start(page, { document: planned({ categories, blocks: [], tasks: [] }) })
    await openCategoryAdd(page)
    await tap(page, 'Familia')
    await tap(page, 'Sin horario fijo')
    await tap(page, 'No, eso es todo')
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    expect((await stored(page)).categories.at(-1)).toMatchObject({ name: 'Familia', colorKey: 'blue' })
    await page.getByRole('button', { name: 'Editar Familia' }).click()
    const sheet = page.getByRole('dialog', { name: 'Editar categoría' })
    await sheet.getByRole('radio', { name: 'Turquesa' }).check()
    await sheet.getByRole('button', { name: 'Guardar' }).click()
    await expect(sheet).toBeHidden()
    expect((await stored(page)).categories.at(-1)).toMatchObject({ name: 'Familia', colorKey: 'teal' })
  })

  test('S2-7: Ejercicio, absent from the week, asks when and saves with its icon and an "at least" goal', async ({ page }) => {
    await start(page, { document: planned() })
    await openCategoryAdd(page)
    await tap(page, 'Ejercicio')
    await onScreen(page, 'extra:exercise')
    await expect(live(page).getByRole('heading', { level: 3 })).toHaveText('¿Cuándo haces ejercicio?')
    await sendAndFinish(page)
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    const exercise = (await stored(page)).categories.at(-1)!
    expect(exercise).toMatchObject({ name: 'Ejercicio', icon: '🏃', goal: { type: 'min' } })
  })
})

test.describe('closing, leaving and conflicts (S2-10, S2-13)', () => {
  test('S2-10: Escape after one answer writes nothing, gives focus back to "+", and the next open starts fresh', async ({ page }) => {
    await start(page, { document: planned() })
    await loaded(page)
    const before = await bytes(page)
    await openWeekAdd(page)
    await tap(page, 'Familia')
    await onScreen(page, 'extra:family')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('setup')).toHaveCount(0)
    await expect(page.getByTestId('week-add')).toBeFocused()
    expect(await bytes(page)).toEqual(before)
    await addFromMenu(page, 'Rutina')
    await onScreen(page, 'more')
    await expect(live(page).locator('[data-answer]')).toHaveCount(0)
    await expect(live(page).getByText('Seguimos donde lo dejaste.')).toHaveCount(0)
  })

  test('S2-10: leaving the page asks first only while something was typed or answered', async ({ page }) => {
    await start(page, { document: planned() })
    await openWeekAdd(page)
    const dialogs: string[] = []
    page.on('dialog', (dialog) => { dialogs.push(dialog.type()); void dialog.dismiss() })
    // Clean session: no question.
    await page.evaluate(() => { const event = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(event); (window as unknown as { __prevented: boolean }).__prevented = event.defaultPrevented })
    expect(await page.evaluate(() => (window as unknown as { __prevented: boolean }).__prevented)).toBe(false)
    await tap(page, 'Otra cosa')
    await live(page).getByTestId('more-other-name').fill('Guitarra')
    await page.close({ runBeforeUnload: true })
    await expect.poll(() => dialogs).toEqual(['beforeunload'])
  })

  test('S2-10: after closing the add session, leaving the page asks nothing', async ({ page }) => {
    await start(page, { document: planned() })
    await openWeekAdd(page)
    await tap(page, 'Otra cosa')
    await live(page).getByTestId('more-other-name').fill('Guitarra')
    await live(page).getByTestId('more-other-name').press('Escape')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('setup')).toHaveCount(0)
    const dialogs: string[] = []
    page.on('dialog', (dialog) => { dialogs.push(dialog.type()); void dialog.dismiss() })
    await page.close({ runBeforeUnload: true })
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(dialogs).toEqual([])
  })

  test('S2-10: a closed setup draft stays byte-identical while adds open, close, save and meet a conflict', async ({ page }) => {
    await start(page, { document: planned() })
    await loaded(page)
    await page.evaluate(() => sessionStorage.setItem('next168-setup-draft', '{"version":3,"seeded":true}'))
    const draft = () => page.evaluate(() => sessionStorage.getItem('next168-setup-draft'))
    const seeded = await draft()
    await openWeekAdd(page)
    await tap(page, 'Familia')
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('setup')).toHaveCount(0)
    expect(await draft()).toBe(seeded)
    await openWeekAdd(page)
    await typeOwn(page, 'Leer')
    await sendAndFinish(page)
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    expect(await draft()).toBe(seeded)
    await openWeekAdd(page)
    await typeOwn(page, 'Correr')
    await sendAndFinish(page)
    await writeStoredDocument(page, { ...(await stored(page)), revision: (await stored(page)).revision + 1 })
    await primary(page).click()
    await expect(page.getByTestId('changed-elsewhere')).toHaveText(CHANGED)
    expect(await draft()).toBe(seeded)
  })

  test('S2-13: a week changed in another window is not written over; "Entendido" starts again at the first question', async ({ page }) => {
    await start(page, { document: planned() })
    await openWeekAdd(page)
    await typeOwn(page, 'Leer')
    await sendAndFinish(page)
    const other = { ...(await stored(page)), revision: (await stored(page)).revision + 1, blocks: [SLEEP_BLOCK] }
    await writeStoredDocument(page, other)
    const written = await bytes(page)
    await primary(page).click()
    await expect(page.getByTestId('changed-elsewhere')).toHaveText(CHANGED)
    await page.getByTestId('understood').click()
    await onScreen(page, 'more')
    await expect(live(page).getByRole('heading', { level: 3 })).toHaveText('¿Para qué quieres hacer tiempo?')
    await expect(live(page).locator('[data-answer]')).toHaveCount(0)
    expect(await bytes(page)).toEqual(written)
  })
})

test.describe('what the summary says (S2-12, S2-14)', () => {
  test('S2-12: time added to Trabajo over its "at most" goal warns on both cards with the total, and still saves', async ({ page }) => {
    await start(page, { document: planned() })
    await loaded(page)
    const before = await stored(page)
    await openWeekAdd(page)
    await tap(page, 'Trabajo')
    await tap(page, 'Enviar respuesta')
    await onScreen(page, 'more:1')
    await typeOwn(page, 'Reunión', 'Trabajo')
    await sendAndFinish(page)
    const warnings = live(page).getByTestId('card-warning')
    await expect(warnings).toHaveCount(2)
    for (const warning of await warnings.all()) await expect(warning).toHaveText('⚠ Trabajo superaría su meta semanal en 10 h. Aun así puedes guardar.')
    await primary(page).click()
    await expect(page.getByTestId('setup')).toHaveCount(0)
    expect((await stored(page)).revision).toBe(before.revision + 1)
  })

  test('S2-14: a suggestion with no free time next to a stored block says what it clashes with', async ({ page }) => {
    const busy = { id: 'c-busy', name: 'Ocupado', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 } }
    await start(page, { document: planned({ categories: [SLEEP, WORK, busy], blocks: [SLEEP_BLOCK, WORK_BLOCK, { id: 'b-busy', categoryId: 'c-busy', title: 'Ocupado', days: [6], start: 360, end: 1320 }] }) })
    await openWeekAdd(page)
    await tap(page, 'Familia')
    await onScreen(page, 'extra:family')
    await expect(live(page).getByTestId('range-message')).toContainText('Se cruza con Ocupado')
  })
})

test('GUARD: an empty hour opens "Nueva rutina", a block opens "Editar rutina", a category opens its sheet', async ({ page }) => {
  await start(page, { document: planned(), size: { width: 1440, height: 900 } })
  await page.goto('./#/week')
  await expect(page.getByRole('heading', { level: 1, name: 'Semana' })).toBeVisible()
  await openClassicRoutine(page)
  await expect(page.getByRole('dialog', { name: 'Nueva rutina' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.locator('[data-date="2026-10-26"] [data-block-id="b-work"]').first().click()
  await expect(page.getByRole('dialog', { name: 'Editar rutina' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.goto('./#/settings')
  await page.getByRole('button', { name: 'Editar Trabajo' }).click()
  await expect(page.getByRole('dialog', { name: 'Editar categoría' })).toBeVisible()
})
