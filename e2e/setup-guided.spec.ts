import { expect, test, type Page } from '@playwright/test'
import { seedLegacy } from './fixtures'
import { storedPlanner, storedRecord } from './support/indexedDb'
import {
  bytes, calm, holdCommitLock, live, onScreen, openFromSettings, primary, secondary, setup, skipToSummary, start, storedDoc, tap, writeStoredDocument,
} from './support/setupGuided'

// The guided first-run setup ("Configura tu semana"): one question per screen, one guarded commit at the end, a draft
// that survives a reload, and closing that never writes. es-CO, America/Bogota, Monday 2026-10-26 10:15, 390x844.
test.use({ locale: 'es-CO', timezoneId: 'America/Bogota', launchOptions: { args: ['--disable-features=WebGPU'] } })
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'sizes are set per test') })

type Doc = ReturnType<typeof storedDoc>
const SLEEP = { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } }
const WORK = { id: 'c-work', name: 'Trabajo', colorKey: 'blue', icon: '💼', goal: { type: 'max', hoursPerWeek: 40 } }
const SLEEP_BLOCK = { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sueño', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 }
const WORK_BLOCK = { id: 'b-work', categoryId: 'c-work', title: 'Trabajo', days: [1, 2, 3, 4, 5], start: 540, end: 1020, notes: 'Llevar el portátil' }
const planned = (extra: Record<string, unknown> = {}) => storedDoc({ categories: [SLEEP, WORK], blocks: [SLEEP_BLOCK, WORK_BLOCK], ...extra })
const firstRun = (extra: Record<string, unknown> = {}) => storedDoc({ workspaceId: 'ws-first-run', ...extra }, false)
const CHANGED = 'Tu semana cambió en otra ventana. Te mostramos la versión actual.'

async function stored(page: Page): Promise<Doc> {
  return storedPlanner<Doc>(page)
}

async function openRow(page: Page, category: string, field: 'days' | 'start' | 'end'): Promise<void> {
  await live(page).locator(`[data-category="${category}"] button[aria-expanded]`).first().click()
  await live(page).locator(`[data-category="${category}"] [data-field=${field}]`).first().click()
}

test.describe('the draft and what it is bound to', () => {
  test('A3: a first run on empty storage reopens on the same screen with the same answer after a reload', async ({ page }) => {
    await start(page)
    await page.goto('./')
    await onScreen(page, 'sleep')
    await tap(page, 'Siguiente')
    await onScreen(page, 'workStudy')
    await tap(page, 'Trabajo')
    await onScreen(page, 'work')
    await live(page).locator('[data-field=end]').click()
    await live(page).locator('[data-minute="1080"]').click()
    await expect(live(page).locator('[data-field=end] .value')).toHaveText('6:00 p. m.')

    await page.reload()
    await onScreen(page, 'work')
    await expect(live(page).getByText('Seguimos donde lo dejaste.')).toBeVisible()
    await expect(live(page).locator('[data-field=end] .value')).toHaveText('6:00 p. m.')
    expect(await storedRecord(page, 'document')).toBeNull()
  })

  test('A4: a draft from empty storage is not applied to an older build\'s data imported before the reload', async ({ page }) => {
    await start(page)
    await page.goto('./')
    await tap(page, 'Siguiente')
    await tap(page, 'Trabajo')
    await onScreen(page, 'work')
    // An older build's data appears before the reload: the app imports it as a revision-0 document.
    const legacy = { categories: [{ id: 'c-read', name: 'Lectura', color: '#10b981', weeklyHourLimit: 5 }], timeBlocks: [{ id: 'b-read', categoryId: 'c-read', title: 'Lectura', dayOfWeek: 2, startTime: '20:00', endTime: '21:00', durationMinutes: 60 }] }
    await seedLegacy(page, JSON.stringify(legacy))
    await page.reload()
    await expect(setup(page).getByRole('alert')).toHaveText(CHANGED)
    const migrated = await stored(page)
    expect(migrated.revision).toBe(0)
    expect(migrated.categories.map((category: { name: string }) => category.name)).toEqual(['Lectura'])
    await setup(page).getByRole('button', { name: 'Entendido' }).click()
    await onScreen(page, 'summary')
    await expect(live(page).locator('[data-category]')).toHaveCount(1)
    await expect(live(page).locator('[data-category]')).toContainText('Lectura')
    expect(await page.evaluate(() => sessionStorage.getItem('next168-setup-draft'))).toBeNull()
    expect(await stored(page)).toEqual(migrated)
  })
})

test.describe('one guarded commit', () => {
  // Another window replaced the content without moving the revision (a controlled fixture: a Settings import would
  // move it), and this tab was not told: no BroadcastChannel, no focus event.
  async function replacedElsewhere(page: Page): Promise<Doc> {
    const opened = await stored(page)
    const other = { ...opened, categories: [{ id: 'c-b', name: 'Desde B', colorKey: 'teal', goal: { type: 'none', hoursPerWeek: 0 } }], blocks: [{ id: 'b-b', categoryId: 'c-b', title: 'Desde B', days: [2], start: 1200, end: 1260 }] }
    await writeStoredDocument(page, other)
    return other as Doc
  }

  test('A7, A11: a save over content another window replaced at the same revision is refused, then works on the current week', async ({ page }) => {
    await page.addInitScript(() => {
      class Silent { postMessage(): void {} close(): void {} addEventListener(): void {} removeEventListener(): void {} onmessage = null }
      ;(window as unknown as { BroadcastChannel: unknown }).BroadcastChannel = Silent
    })
    await start(page, { document: firstRun() })
    await page.goto('./')
    await onScreen(page, 'sleep')
    await skipToSummary(page)
    const other = await replacedElsewhere(page)
    const before = await bytes(page)

    await primary(page).click()
    await expect(setup(page).getByRole('alert')).toHaveText(CHANGED)
    expect(await bytes(page)).toEqual(before)
    await setup(page).getByRole('button', { name: 'Entendido' }).click()
    await onScreen(page, 'summary')
    await expect(live(page).locator('[data-category]')).toContainText('Desde B')

    // A11: one edit on the current week saves, keeping B's content and adding A's edit.
    await openRow(page, (await live(page).locator('[data-category]').first().getAttribute('data-category'))!, 'end')
    await live(page).locator('[data-minute="1320"]').click()
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    const saved = await stored(page)
    expect(saved.revision).toBe(other.revision + 1)
    expect(saved.categories).toEqual(other.categories)
    expect(saved.blocks).toEqual([{ ...(other.blocks[0] as object), end: 1320 }])
    expect(saved.settings.onboardingDone).toBe(true)
  })

  test('A12: saving with no change writes nothing, even with stored days out of order', async ({ page }) => {
    await start(page, { document: planned({ blocks: [SLEEP_BLOCK, { ...WORK_BLOCK, days: [5, 1, 3, 2, 4] }] }) })
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    await openFromSettings(page)
    await onScreen(page, 'summary')
    const before = await bytes(page)
    await expect(primary(page)).toHaveText('Guardar cambios')
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    expect(await bytes(page)).toEqual(before)
  })

  test('A14: changing one end time keeps every id, the notes, a custom title and the task', async ({ page }) => {
    const meeting = { id: 'b-meet', categoryId: 'c-work', title: 'Reunión semanal', days: [6], start: 600, end: 660, notes: 'Sala 2' }
    const office = { id: 'c-office', name: 'Oficina', colorKey: 'teal', goal: { type: 'none', hoursPerWeek: 0 } }
    const task = { id: 't-1', title: 'Informe', categoryId: 'c-work', durationMin: 60, priority: 2, createdAt: '2026-10-20T08:00:00.000Z' }
    const document = planned({ categories: [SLEEP, WORK, office], blocks: [SLEEP_BLOCK, WORK_BLOCK, meeting], tasks: [task] })
    await start(page, { document })
    await page.goto('./')
    await openFromSettings(page)
    const before = await stored(page)
    await live(page).getByTestId('card-work').click()
    await live(page).locator('[data-category=work] [data-field=end]').first().click()
    await live(page).locator('[data-minute="1080"]').click()
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    const after = await stored(page)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.categories).toEqual(before.categories)
    expect(after.tasks).toEqual(before.tasks)
    expect(after.blocks).toEqual([SLEEP_BLOCK, { ...WORK_BLOCK, end: 1080 }, meeting])
  })

  test('A14: answering "Trabajo" when only a renamed "Oficina" exists shows two cards before saving, never a silent duplicate', async ({ page }) => {
    const office = { id: 'c-office', name: 'Oficina', colorKey: 'teal', goal: { type: 'none', hoursPerWeek: 0 } }
    await start(page, { document: storedDoc({ categories: [office], blocks: [{ id: 'b-office', categoryId: 'c-office', title: 'Oficina', days: [1, 2, 3, 4, 5], start: 480, end: 960 }] }) })
    await page.goto('./')
    await openFromSettings(page)
    await live(page).getByTestId('summary-review').click()
    await onScreen(page, 'sleep')
    await tap(page, 'Saltar')
    await tap(page, 'Trabajo')
    await onScreen(page, 'work')
    await live(page).getByRole('button', { name: 'Sin horario fijo' }).click()
    await skipToSummary(page)
    await expect(live(page).locator('[data-category]')).toHaveCount(2)
    await expect(live(page).locator('[data-category] .name')).toHaveText(['Oficina', 'Trabajo'])
  })
})

test.describe('closing never writes', () => {
  const PATHS = ['✕', 'Escape', 'scrim', 'drag'] as const

  async function close(page: Page, path: (typeof PATHS)[number]): Promise<void> {
    await calm(page)
    if (path === '✕') await page.getByRole('button', { name: 'Ahora no' }).click()
    else if (path === 'Escape') await page.keyboard.press('Escape')
    else if (path === 'scrim') await page.mouse.click(195, 8)
    else {
      const handle = (await page.locator('.sheet-handle').boundingBox())!
      await page.mouse.move(handle.x + handle.width / 2, handle.y + 2)
      await page.mouse.down()
      for (let step = 1; step <= 10; step++) await page.mouse.move(handle.x + handle.width / 2, handle.y + 2 + step * 50)
      await page.mouse.up()
    }
    await expect(setup(page)).toHaveCount(0)
  }

  for (const path of PATHS) {
    test(`A8, A9: closing by ${path} writes nothing, does not reopen by itself, and Hoy brings the same answers back`, async ({ page }) => {
      await start(page, { document: firstRun() })
      await page.goto('./')
      await onScreen(page, 'sleep')
      const before = await bytes(page)
      await tap(page, 'Siguiente')
      await tap(page, 'Las dos cosas')
      await onScreen(page, 'work')
      await close(page, path)
      expect(await bytes(page)).toEqual(before)
      expect((await stored(page)).settings.onboardingDone).toBe(false)

      await page.reload()
      await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
      await page.waitForTimeout(300)
      await expect(setup(page)).toHaveCount(0)
      const offer = page.getByTestId('setup-week')
      await expect(offer).toHaveText('Configurar mi semana · 1 min')
      await offer.click()
      await onScreen(page, 'work')
      await live(page).getByTestId('setup-back').click()
      await onScreen(page, 'workStudy')
      await expect(live(page).getByRole('button', { name: 'Las dos cosas (actual)' })).toBeVisible()
      expect(await bytes(page)).toEqual(before)
    })
  }

  test('A9, A39: onboardingDone is written only by the final commit, with one revision; skipping everything saves an empty week', async ({ page }) => {
    const event = { id: 'e-1', title: 'Cita', start: '2026-10-28T14:00:00.000Z', end: '2026-10-28T15:00:00.000Z', allDay: false, attendees: [] }
    await start(page, { document: firstRun({ events: [event], checkIns: [{ date: '2026-10-25', note: 'Bien' }] }) })
    await page.goto('./')
    await onScreen(page, 'sleep')
    const before = await stored(page)
    await page.getByRole('button', { name: 'Ahora no' }).click()
    await expect(setup(page)).toHaveCount(0)
    expect(await page.evaluate(() => localStorage.getItem('next168-setup-dismissed'))).toBe('ws-first-run')
    await page.getByTestId('setup-week').click()
    await onScreen(page, 'sleep')
    await skipToSummary(page)
    await expect(live(page).getByRole('heading', { level: 3 })).toHaveText('Aún no hay nada. Puedes añadir algo o empezar así.')
    await expect(primary(page)).toHaveText('Empezar')
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    const after = await stored(page)
    expect(after.revision).toBe(before.revision + 1)
    expect(after.settings).toEqual({ ...before.settings, onboardingDone: true })
    expect(after.categories).toEqual([])
    expect(after.blocks).toEqual([])
    expect(after.events).toEqual(before.events)
    expect(after.checkIns).toEqual(before.checkIns)
    expect(after.tasks).toEqual(before.tasks)
    expect(await page.evaluate(() => [sessionStorage.getItem('next168-setup-draft'), localStorage.getItem('next168-setup-dismissed')])).toEqual([null, null])
  })

  test('A10: an edit opened from Ajustes survives a reload, on the same screen, with nothing written', async ({ page }) => {
    await start(page, { document: planned() })
    await page.goto('./')
    await openFromSettings(page)
    await onScreen(page, 'summary')
    const before = await bytes(page)
    await live(page).getByTestId('card-work').click()
    await live(page).locator('[data-category=work] [data-field=end]').first().click()
    await live(page).locator('[data-minute="1080"]').click()
    await page.reload()
    await onScreen(page, 'summary')
    await expect(live(page).getByTestId('card-work')).toContainText('9:00 a. m.–6:00 p. m.')
    expect(await bytes(page)).toEqual(before)
  })

  test('A26: after a save whose draft removal throws, a reload shows neither the flow nor a message', async ({ page }) => {
    await start(page, { document: firstRun() })
    await page.goto('./')
    await onScreen(page, 'sleep')
    await tap(page, 'Siguiente')
    await skipToSummary(page)
    await page.evaluate(() => {
      const remove = Storage.prototype.removeItem
      Storage.prototype.removeItem = function (this: Storage, key: string) {
        if (this === sessionStorage) throw new DOMException('denied', 'SecurityError')
        return remove.call(this, key)
      }
    })
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    expect((await stored(page)).settings.onboardingDone).toBe(true)
    const saved = await bytes(page)
    await page.reload()
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    await page.waitForTimeout(300)
    await expect(setup(page)).toHaveCount(0)
    await expect(page.getByText(CHANGED)).toHaveCount(0)
    expect(await bytes(page)).toEqual(saved)
  })
})

test.describe('where the setup opens', () => {
  test('A40: empty Hoy, empty Semana and Ajustes open it with no write; Hoy and Semana stop offering it once a block exists', async ({ page }) => {
    await start(page, { document: storedDoc() })
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    const before = await bytes(page)
    for (const route of ['./', './#/week']) {
      await page.goto(route)
      await page.getByTestId('setup-week').click()
      await onScreen(page, 'sleep')
      await page.getByRole('button', { name: 'Ahora no' }).click()
      await expect(setup(page)).toHaveCount(0)
    }
    await openFromSettings(page)
    await onScreen(page, 'sleep')
    await page.getByRole('button', { name: 'Ahora no' }).click()
    expect(await bytes(page)).toEqual(before)

    // With a block saved, only Ajustes offers it, and it opens at the summary.
    await openFromSettings(page)
    await primary(page).click()
    await onScreen(page, 'workStudy')
    await tap(page, 'Trabajo')
    await primary(page).click()
    await skipToSummary(page)
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    await expect(page.getByTestId('setup-week')).toHaveCount(0)
    await page.goto('./#/week')
    await expect(page.getByRole('heading', { level: 1, name: 'Semana' })).toBeVisible()
    await expect(page.getByTestId('setup-week')).toHaveCount(0)
    await openFromSettings(page)
    await onScreen(page, 'summary')
  })

  test('A36: without Web Locks the setup is not offered and nothing is written', async ({ page }) => {
    await page.addInitScript(() => { Reflect.deleteProperty(Navigator.prototype, 'locks') })
    await start(page, { document: firstRun() })
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    await page.waitForTimeout(300)
    await expect(setup(page)).toHaveCount(0)
    await expect(page.getByTestId('setup-week')).toHaveCount(0)
    await page.goto('./#/settings')
    await expect(page.getByRole('heading', { level: 1, name: 'Ajustes' })).toBeVisible()
    await expect(page.getByTestId('setup-guided-row')).toHaveCount(0)
    expect(await storedRecord(page, 'document')).toBeNull()
  })
})
