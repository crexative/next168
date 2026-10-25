import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { seedLegacy } from './fixtures'
import { storedPlanner, storedRecord } from './support/indexedDb'
import { collectMotion, installMotionSampler } from './support/motionSampler'
import { visualIntegrityViolations } from './support/visualIntegrity'
import {
  bytes, calm, holdCommitLock, live, onScreen, openFromSettings, primary, secondary, setup, skipToSummary, start, storedDoc, tap, writeStoredDocument,
} from './support/setupGuided'

// The guided first-run setup ("Configura tu semana"): one question per screen, one guarded commit at the end, a draft
// that survives a reload, and closing that never writes. es-CO, America/Bogota, Monday 2026-10-26 10:15, 390x844.
test.use({ locale: 'es-CO', timezoneId: 'America/Bogota', launchOptions: { args: ['--disable-features=WebGPU'] } })
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'sizes are set per test') })

interface Doc {
  revision: number
  settings: Record<string, unknown>
  categories: { id: string; name: string }[]
  blocks: { id: string; categoryId: string; days: number[]; start: number; end: number }[]
  tasks: unknown[]
  events: unknown[]
  checkIns: unknown[]
}
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
    await tap(page, 'Enviar respuesta')
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
    await tap(page, 'Enviar respuesta')
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
    return other as unknown as Doc
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
    await tap(page, 'Lo veo después')
    await tap(page, 'Trabajo')
    await onScreen(page, 'work')
    await live(page).getByRole('button', { name: 'Sin horario fijo' }).click()
    await skipToSummary(page)
    await expect(live(page).locator('[data-category]')).toHaveCount(2)
    await expect(live(page).locator('[data-category] .name')).toHaveText(['Oficina', 'Trabajo'])
  })
})

test.describe('closing never writes', () => {
  // Full screen, there is no scrim to tap or sheet to drag: the leading ‹ ("Ahora no") and Escape are the ways out.
  const PATHS = ['‹', 'Escape'] as const

  async function close(page: Page, path: (typeof PATHS)[number]): Promise<void> {
    await calm(page)
    if (path === '‹') await page.getByRole('button', { name: 'Ahora no' }).click()
    else await page.keyboard.press('Escape')
    await expect(setup(page)).toHaveCount(0)
  }

  for (const path of PATHS) {
    test(`A8, A9: closing by ${path} writes nothing, does not reopen by itself, and Hoy brings the same answers back`, async ({ page }) => {
      await start(page, { document: firstRun() })
      await page.goto('./')
      await onScreen(page, 'sleep')
      const before = await bytes(page)
      await tap(page, 'Enviar respuesta')
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
      await live(page).locator('[data-answer=workStudy]').click()
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
    await expect(primary(page)).toHaveText('Crear mi semana')
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
    await tap(page, 'Enviar respuesta')
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

// ---------- Answering ----------

const readCatalogue = (locale: string) => JSON.parse(readFileSync(new URL(`../src/i18n/${locale}/onboarding.json`, import.meta.url), 'utf8')) as Record<string, unknown>
function catalogue(value: unknown, path = ''): [string, string][] {
  if (typeof value === 'string') return [[path, value]]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => catalogue(child, `${path}.${key}`))
}
// English strings that German says differently: seeing one in a German pass means a missing translation.
function englishOnly(locale: string): string[] {
  const translated = new Map(catalogue(readCatalogue(locale)))
  return catalogue(readCatalogue('en')).filter(([path, value]) => translated.get(path) !== value).map(([, value]) => value.replace(/\{\w+\}/g, '').trim()).filter((value) => value.length >= 4)
}

async function auditScreen(page: Page, label: string): Promise<void> {
  await calm(page)
  expect.soft(await page.locator('[data-testid=setup] [data-primary]:visible').count(), `${label}: primary buttons`).toBeLessThanOrEqual(1)
  expect.soft(await page.locator('[data-testid=setup] input[type=color]').count(), `${label}: colour input`).toBe(0)
  expect.soft(await page.getByTestId('setup').getByRole('radiogroup').count(), `${label}: radio group`).toBe(0)
  expect.soft(await page.locator('[data-testid=setup] fieldset legend', { hasText: /color|colour|farbe|couleur|cor/i }).count(), `${label}: colour fieldset`).toBe(0)
}

test.describe('answering', () => {
  test('A30, A31, A37: the typical week takes 11 taps, one primary per screen and no colour control; Hoy then shows Trabajo', async ({ page }) => {
    await start(page)
    await page.goto('./')
    await onScreen(page, 'sleep')
    let taps = 0
    const step = async (action: () => Promise<void>, next: string) => {
      await action()
      taps += 1
      if (next !== '') { await onScreen(page, next); await auditScreen(page, next) }
    }
    await auditScreen(page, 'sleep')
    await step(() => tap(page, 'Enviar respuesta'), 'workStudy')
    await step(() => tap(page, 'Trabajo'), 'work')
    await step(() => tap(page, 'Enviar respuesta'), 'commute')
    await step(() => tap(page, 'Sí'), 'commuteRanges')
    await step(() => tap(page, 'Enviar respuesta'), 'exercise')
    await step(() => tap(page, 'Sí'), 'exerciseRanges')
    await step(() => tap(page, 'Enviar respuesta'), 'more')
    await step(() => live(page).getByRole('button', { name: 'Familia' }).click(), 'more')
    await step(() => tap(page, 'Enviar respuesta'), 'extra:family')
    await step(() => tap(page, 'Enviar respuesta'), 'summary')
    // Pickers and the time editor never add a second filled button.
    await live(page).getByTestId('card-work').click()
    await live(page).locator('[data-category=work] [data-field=start]').first().click()
    await live(page).getByTestId('other-time').click()
    await auditScreen(page, 'summary with the time editor')
    await live(page).getByTestId('card-done').click()
    await step(() => primary(page).click(), '')
    await expect(setup(page)).toHaveCount(0)
    expect(taps).toBe(11)

    await expect(page.getByTestId('now-title')).toHaveText('Trabajo')
    const saved = await stored(page)
    expect(saved.categories.map((category: { name: string }) => category.name)).toEqual(['Sueño', 'Trabajo', 'Desplazamientos', 'Ejercicio', 'Familia'])
  })

  test('A34: from opening the setup to saving it, the browser makes no request', async ({ page }) => {
    await start(page, { document: storedDoc() })
    await page.goto('./')
    await expect(page.getByRole('heading', { level: 1, name: 'Hoy' })).toBeVisible()
    await page.waitForLoadState('networkidle')
    const requests: string[] = []
    page.on('request', (request) => requests.push(`${request.resourceType()} ${request.url()}`))
    await page.getByTestId('setup-week').click()
    await onScreen(page, 'sleep')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Trabajo')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Sí')
    await onScreen(page, 'commuteRanges')
    await skipToSummary(page)
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    expect((await stored(page)).blocks.length).toBe(2)
    expect(requests).toEqual([])
  })

  test('A33: a full pass in German shows no English text from the English catalogue', async ({ page }) => {
    const warnings: string[] = []
    page.on('console', (message) => { if (/not found|fall back|intlify/i.test(message.text())) warnings.push(message.text()) })
    await start(page, { language: 'de' })
    await page.goto('./')
    await onScreen(page, 'sleep')
    const english = englishOnly('de')
    const check = async (label: string) => {
      await calm(page)
      const text = await setup(page).innerText()
      expect.soft(english.filter((value) => text.includes(value)), label).toEqual([])
    }
    const steps: [string, string][] = [['[data-testid=setup-primary]', 'workStudy'], ['[data-value=work]', 'work'], ['[data-testid=setup-primary]', 'commute'], ['[data-value=yes]', 'commuteRanges'],
      ['[data-testid=setup-primary]', 'exercise'], ['[data-value=yes]', 'exerciseRanges'], ['[data-testid=setup-primary]', 'more'], ['[data-chip=family]', 'more'], ['[data-testid=setup-primary]', 'extra:family'], ['[data-testid=setup-primary]', 'summary']]
    await check('sleep')
    for (const [selector, next] of steps) {
      await live(page).locator(selector).click()
      await onScreen(page, next)
      await check(next)
    }
    await live(page).getByTestId('card-work').click()
    await check('summary, a card open')
    expect(warnings).toEqual([])
  })

  test('A17: a suggestion with no free time stays where it is and says why; "Sin horario fijo" saves the category with no times', async ({ page }) => {
    const busy = { id: 'c-busy', name: 'Ocupado', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 } }
    await start(page, { document: firstRun({ categories: [busy], blocks: [{ id: 'b-busy', categoryId: 'c-busy', title: 'Ocupado', days: [1, 3, 5], start: 360, end: 1320 }] }) })
    await page.goto('./')
    await onScreen(page, 'sleep')
    await tap(page, 'Lo veo después')
    await tap(page, 'Lo veo después')
    await onScreen(page, 'exercise')
    await tap(page, 'Sí')
    await onScreen(page, 'exerciseRanges')
    await expect(live(page).locator('[data-field=start] .value')).toHaveText('6:00 p. m.')
    await expect(live(page).getByTestId('range-message')).toContainText('Se cruza con Ocupado')
    await secondary(page).click()
    await onScreen(page, 'more')
    await skipToSummary(page)
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    const saved = await stored(page)
    const exercise = saved.categories.find((category) => category.name === 'Ejercicio')!
    expect(exercise).toBeDefined()
    expect(saved.blocks.filter((block) => block.categoryId === exercise.id)).toEqual([])
    expect(saved.blocks.map((block: { id: string }) => block.id)).toEqual(['b-busy'])
  })

  test('A18: "Otra hora" sets 7:35 a. m. with steppers and a deliberate confirm; Escape cancels', async ({ page }) => {
    await start(page)
    await page.goto('./')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Trabajo')
    await onScreen(page, 'work')
    await live(page).locator('[data-field=start]').click()
    await live(page).getByTestId('other-time').click()
    const value = live(page).getByTestId('time-value')
    await expect(value).toHaveText('9:00 a. m.')
    await expect(live(page).getByTestId('time-period')).toBeVisible()
    for (let index = 0; index < 2; index++) await live(page).locator('[data-step=hour-down]').click()
    for (let index = 0; index < 7; index++) await live(page).locator('[data-step=minutes-up]').click()
    await expect(value).toHaveText('7:35 a. m.')
    await expect(live(page).locator('[data-field=start] .value')).toHaveText('9:00 a. m.')
    await live(page).getByRole('button', { name: 'Usar 7:35 a. m.' }).click()
    await expect(live(page).locator('[data-field=start] .value')).toHaveText('7:35 a. m.')

    await live(page).locator('[data-field=start]').click()
    await live(page).getByTestId('other-time').click()
    await live(page).locator('[data-step=minutes-up]').click()
    await expect(value).toHaveText('7:40 a. m.')
    await page.keyboard.press('Escape')
    await expect(live(page).getByTestId('time-value')).toHaveCount(0)
    await expect(setup(page)).toBeVisible()
    await expect(live(page).locator('[data-field=start] .value')).toHaveText('7:35 a. m.')
    await tap(page, 'Enviar respuesta')
    await skipToSummary(page)
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    const saved = await stored(page)
    const work = saved.categories.find((category) => category.name === 'Trabajo')!
    expect(saved.blocks.filter((block) => block.categoryId === work.id)).toEqual([expect.objectContaining({ start: 455, end: 1020, days: [1, 2, 3, 4, 5] })])
  })

  test('A18: with a 24-hour clock the editor shows 09:00 and no a. m./p. m. switch', async ({ page }) => {
    await start(page, { language: 'de' })
    await page.goto('./')
    await live(page).locator('[data-testid=setup-primary]').click()
    await live(page).locator('[data-value=work]').click()
    await onScreen(page, 'work')
    await live(page).locator('[data-field=start]').click()
    await live(page).getByTestId('other-time').click()
    await expect(live(page).getByTestId('time-value')).toHaveText('9:00')
    await expect(live(page).getByTestId('time-period')).toHaveCount(0)
    // A 24-hour clock: ten hours back from 9:00 is 23:00, not 11 in the morning or evening of a 12-hour clock.
    for (let index = 0; index < 10; index++) await live(page).locator('[data-step=hour-down]').click()
    await expect(live(page).getByTestId('time-value')).toHaveText('23:00')
  })

  test('A18: a stored 7:33 is shown as it is and kept while untouched', async ({ page }) => {
    await start(page, { document: planned({ blocks: [SLEEP_BLOCK, { ...WORK_BLOCK, start: 453 }] }) })
    await page.goto('./')
    await openFromSettings(page)
    const before = await bytes(page)
    await live(page).getByTestId('card-work').click()
    await expect(live(page).locator('[data-category=work] [data-field=start] .value')).toHaveText('7:33 a. m.')
    await live(page).locator('[data-category=work] [data-field=start]').click()
    await live(page).getByTestId('other-time').click()
    await expect(live(page).getByTestId('time-value')).toHaveText('7:33 a. m.')
    await page.keyboard.press('Escape')
    await page.keyboard.press('Escape')
    await expect(setup(page)).toBeVisible()
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    expect(await bytes(page)).toEqual(before)
  })

  test('A19: Tab explores the quick replies without answering, Enter answers, and the last range can be removed', async ({ page }) => {
    await start(page)
    await page.goto('./')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Trabajo')
    await tap(page, 'Enviar respuesta')
    await onScreen(page, 'commute')
    await live(page).getByRole('button', { name: 'Sí', exact: true }).focus()
    await page.keyboard.press('Tab')
    await expect(live(page).getByRole('button', { name: 'No', exact: true })).toBeFocused()
    await page.waitForTimeout(300)
    await expect(setup(page)).toHaveAttribute('data-screen', 'commute')
    await page.keyboard.press('Enter')
    await onScreen(page, 'exercise')
    await live(page).locator('[data-answer=commute]').click()
    await onScreen(page, 'commute')
    await expect(live(page).getByRole('button', { name: 'No (actual)' })).toBeVisible()
    await live(page).getByRole('button', { name: 'Sí', exact: true }).focus()
    await page.keyboard.press('Enter')
    await onScreen(page, 'commuteRanges')

    await live(page).locator('[data-answer=work]').click()
    await onScreen(page, 'work')
    await expect(live(page).getByTestId('range-remove')).toHaveCount(1)
    await live(page).getByTestId('range-remove').click()
    await expect(live(page).locator('[data-range]')).toHaveCount(0)
    await expect(live(page).getByTestId('range-add')).toBeVisible()
    await skipToSummary(page)
    await expect(live(page).getByTestId('card-work')).toContainText('Sin horario')
  })

  test('A20: overlapping stored times count once: 161 h asignadas, 7 h sin asignar, and a warning', async ({ page }) => {
    const shiftA = { id: 'c-a', name: 'Turno A', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }
    const shiftB = { id: 'c-b', name: 'Turno B', colorKey: 'red', goal: { type: 'none', hoursPerWeek: 0 } }
    const everyDay = [0, 1, 2, 3, 4, 5, 6]
    await start(page, { document: storedDoc({ categories: [shiftA, shiftB], blocks: [
      { id: 'b-a', categoryId: 'c-a', title: 'Turno A', days: everyDay, start: 0, end: 1380 },
      { id: 'b-b', categoryId: 'c-b', title: 'Turno B', days: everyDay, start: 0, end: 1380 },
    ] }) })
    await page.goto('./')
    await openFromSettings(page)
    await expect(live(page).getByTestId('week-counter')).toHaveText('161 h asignadas · 7 h sin asignar')
    await expect(live(page).getByTestId('overlap-warning')).toHaveText('⚠ Algunos horarios se cruzan. Las horas cruzadas cuentan una vez.')
  })

  test('A22: "Quitar" turns a card into a row that "Deshacer" restores; a category with tasks keeps its record', async ({ page }) => {
    await start(page)
    await page.goto('./')
    await tap(page, 'Lo veo después')
    await tap(page, 'Lo veo después')
    await tap(page, 'Lo veo después')
    await onScreen(page, 'more')
    await live(page).getByRole('button', { name: 'Familia' }).click()
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Enviar respuesta')
    await onScreen(page, 'summary')
    const card = live(page).getByTestId('card-family')
    const text = (await card.textContent())!
    await card.click()
    await live(page).getByRole('button', { name: 'Quitar Familia' }).click()
    await expect(live(page).getByTestId('removed-note')).toHaveText('«Familia» quitado.')
    await live(page).getByRole('button', { name: 'Deshacer' }).click()
    await expect(live(page).getByTestId('card-family')).toHaveText(text)
  })

  test('A22: a category with tasks offers no "Quitar", and answering "No" keeps it with no times', async ({ page }) => {
    const exercise = { id: 'c-ex', name: 'Ejercicio', colorKey: 'green', icon: '🏃', goal: { type: 'min', hoursPerWeek: 3 } }
    const task = { id: 't-run', title: 'Correr', categoryId: 'c-ex', durationMin: 30, priority: 2, createdAt: '2026-10-20T08:00:00.000Z' }
    await start(page, { document: planned({ categories: [SLEEP, WORK, exercise], blocks: [SLEEP_BLOCK, WORK_BLOCK, { id: 'b-gym', categoryId: 'c-ex', title: 'Gimnasio', days: [1, 3, 5], start: 1080, end: 1140 }], tasks: [task] }) })
    await page.goto('./')
    await openFromSettings(page)
    await live(page).getByTestId('card-exercise').click()
    await expect(live(page).getByTestId('has-tasks')).toHaveText('Tiene tareas. Para quitarlo, ve a Ajustes › Categorías y metas.')
    await expect(live(page).getByTestId('card-remove')).toHaveCount(0)
    await live(page).getByTestId('summary-review').click()
    await onScreen(page, 'sleep')
    await tap(page, 'Lo veo después')
    await tap(page, 'Lo veo después')
    await onScreen(page, 'exercise')
    await tap(page, 'No')
    await skipToSummary(page)
    await expect(live(page).getByTestId('kept-for-tasks')).toHaveText('«Ejercicio» se queda sin horario porque tiene tareas.')
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    const saved = await stored(page)
    expect(saved.categories.map((category: { id: string }) => category.id)).toEqual(['c-sleep', 'c-work', 'c-ex'])
    expect(saved.blocks.map((block: { id: string }) => block.id)).toEqual(['b-sleep', 'b-work'])
    expect(saved.tasks).toEqual([task])
  })

  test('A23: a setup save withdraws a Week undo offered before it', async ({ page }) => {
    const exercise = { id: 'c-ex', name: 'Ejercicio', colorKey: 'green', icon: '🏃', goal: { type: 'min', hoursPerWeek: 3 } }
    await start(page, { document: planned({ categories: [SLEEP, WORK, exercise], blocks: [SLEEP_BLOCK, WORK_BLOCK, { id: 'b-gym', categoryId: 'c-ex', title: 'Gimnasio', days: [1], start: 1080, end: 1140 }] }) })
    await page.goto('./#/week')
    await expect(page.getByRole('heading', { level: 1, name: 'Semana' })).toBeVisible()
    await page.locator('[data-date="2026-10-26"] [data-block-id="b-gym"]').first().click()
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar rutina' }).click()
    await expect(page.getByTestId('undo-toast')).toBeVisible()
    await page.evaluate(() => { location.hash = '#/settings' })
    await page.getByTestId('setup-guided-row').getByRole('button').click()
    await onScreen(page, 'summary')
    await live(page).getByTestId('card-exercise').click()
    await live(page).locator('[data-category=exercise]').getByTestId('range-add').click()
    await expect(page.getByTestId('undo-toast')).toBeVisible()
    await primary(page).click()
    await expect(setup(page)).toHaveCount(0)
    await expect(page.getByTestId('undo-toast')).toHaveCount(0)
    const saved = await stored(page)
    type Block = { days: number[]; start: number; end: number }
    const occupied = new Set<number>()
    let overlap = false
    for (const block of saved.blocks as Block[]) {
      for (const day of block.days) {
        const length = (block.end - block.start + 1440) % 1440
        for (let minute = 0; minute < length; minute++) {
          const at = (day * 1440 + block.start + minute) % 10080
          if (occupied.has(at)) overlap = true
          occupied.add(at)
        }
      }
    }
    expect(overlap).toBe(false)
  })

  test('A24: while saving nothing closes or edits the sheet, a double tap and a route change make one commit', async ({ page }) => {
    await start(page, { document: firstRun() })
    await page.goto('./')
    await onScreen(page, 'sleep')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Trabajo')
    await onScreen(page, 'work')
    await tap(page, 'Enviar respuesta')
    await skipToSummary(page)
    const before = (await stored(page)).revision
    const release = await holdCommitLock(page)
    await primary(page).dblclick()
    await expect(page.locator('.setup-lock')).toHaveAttribute('inert')
    await expect(setup(page)).toHaveAttribute('aria-busy', 'true')
    const head = (await live(page).getByTestId('card-work').boundingBox())!
    await page.mouse.click(head.x + head.width / 2, head.y + head.height / 2)
    await expect(live(page).locator('[data-category=work] [data-field=end]')).toHaveCount(0)
    await page.keyboard.press('Escape')
    const close = (await page.locator('.setup-close').boundingBox())!
    await page.mouse.click(close.x + close.width / 2, close.y + close.height / 2)
    // An earlier answer cannot reopen its question while the save is pending either.
    const earlier = live(page).locator('[data-answer=workStudy]')
    await earlier.scrollIntoViewIfNeeded()
    const turn = (await earlier.boundingBox())!
    await page.mouse.click(turn.x + turn.width / 2, turn.y + turn.height / 2)
    await expect(setup(page)).toHaveAttribute('data-screen', 'summary')
    await page.evaluate(() => { location.hash = '#/week' })
    await expect(setup(page)).toBeVisible()
    await release()
    await expect(setup(page)).toHaveCount(0)
    await page.waitForTimeout(300)
    const saved = await stored(page)
    expect(saved.revision).toBe(before + 1)
    const work = saved.categories.find((category) => category.name === 'Trabajo')!
    expect(saved.blocks.filter((block) => block.categoryId === work.id)).toEqual([expect.objectContaining({ start: 540, end: 1020 })])
  })
})

test.describe('a template week in a daylight-saving week', () => {
  test.use({ timezoneId: 'Europe/Berlin' })

  test('A25: Sueño 11 p. m. to 7 a. m. every night is 56 h in the summary, while Hoy counts the night\'s real length', async ({ page }) => {
    const document = planned({ settings: { timeZone: 'Europe/Berlin' } })
    // Sunday 2026-10-25 00:30 in Berlin: clocks go back at 03:00, so this night lasts an hour longer.
    await start(page, { document, at: new Date('2026-10-24T22:30:00.000Z') })
    await page.goto('./')
    await expect(page.getByTestId('now-title')).toHaveText('Sueño')
    await expect(page.getByTestId('now-left')).toHaveText('Quedan 7 h 30 min')
    await openFromSettings(page)
    await expect(live(page).getByTestId('card-sleep')).toContainText('56 h')
  })
})

// ---------- Room for everyone: targets, text size, narrow screens, the keyboard, motion ----------

interface TargetProblem { what: string; problem: string }

// Every visible control in the sheet: at least 48x48, at least 8 px from its neighbours in the same layer, and the
// control itself is what a tap at its centre reaches.
async function targetProblems(page: Page): Promise<TargetProblem[]> {
  return page.evaluate(() => {
    const panel = document.querySelector('[role=dialog]')!
    const selector = 'button, input, a[href], [role=button], [tabindex]:not([tabindex="-1"])'
    const controls = Array.from(panel.querySelectorAll<HTMLElement>(selector)).filter((element) => {
      const rect = element.getBoundingClientRect()
      return rect.width > 0 && rect.height > 0 && !element.closest('[aria-hidden=true]') && getComputedStyle(element).visibility !== 'hidden'
    })
    const name = (element: HTMLElement) => `${element.tagName.toLowerCase()} "${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40)}"`
    const problems: { what: string; problem: string }[] = []
    const layer = (element: HTMLElement) => (element.closest('.dock-answer') ? 'dock' : element.closest('footer') ? 'footer' : element.closest('.setup-scroller') ? 'body' : 'header')
    // The conversation and the docked answers scroll on their own: positions are compared as if neither had scrolled.
    const scrollers = Array.from(panel.querySelectorAll<HTMLElement>('.setup-scroller, .dock-answer'))
    const scrolledBy = (element: HTMLElement) => scrollers.filter((scroller) => scroller.contains(element)).reduce((sum, scroller) => sum + scroller.scrollTop, 0)
    const boxes = controls.map((element) => {
      element.scrollIntoView({ block: 'center', inline: 'nearest' })
      const rect = element.getBoundingClientRect()
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
      if (rect.width < 47.5 || rect.height < 47.5) problems.push({ what: name(element), problem: `${Math.round(rect.width)}x${Math.round(rect.height)}` })
      if (!hit || !(element === hit || element.contains(hit))) problems.push({ what: name(element), problem: `a tap at its centre reaches ${hit ? (hit as HTMLElement).outerHTML.slice(0, 60) : 'nothing'}` })
      const offset = scrolledBy(element)
      return { element, layer: layer(element), left: rect.left, right: rect.right, top: rect.top + offset, bottom: rect.bottom + offset }
    })
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const one = boxes[a]!
        const other = boxes[b]!
        if (one.layer !== other.layer || one.element.contains(other.element) || other.element.contains(one.element)) continue
        const gap = Math.max(one.left - other.right, other.left - one.right, one.top - other.bottom, other.top - one.bottom)
        if (gap < 7.5) problems.push({ what: `${name(one.element)} and ${name(other.element)}`, problem: `${Math.round(gap)} px apart` })
      }
    }
    for (const scroller of scrollers) scroller.scrollTop = 0
    return problems
  })
}

// Every screen of a pass with work, commute, exercise and one extra, and on range screens each picker opened in turn.
async function walk(page: Page, visit: (label: string) => Promise<void>, options: { custom?: string } = {}): Promise<void> {
  const pickers = async (label: string) => {
    const range = live(page).locator('[data-range]').first()
    for (const field of ['days', 'start', 'end'] as const) {
      const row = range.locator(`[data-field=${field}]`)
      if (await row.count() === 0) continue
      await row.click()
      if (field === 'days') await live(page).locator('[data-preset=pick]').click()
      await visit(`${label}, ${field} picker`)
      if (field === 'start') {
        await live(page).getByTestId('other-time').click()
        await visit(`${label}, time editor`)
        await page.keyboard.press('Escape')
      }
      await page.keyboard.press('Escape')
    }
  }
  await onScreen(page, 'sleep')
  await visit('sleep')
  await pickers('sleep')
  const steps: [string, string, boolean][] = [['[data-testid=setup-primary]', 'workStudy', false], ['[data-value=both]', 'work', true], ['[data-testid=setup-primary]', 'study', true],
    ['[data-testid=setup-primary]', 'commute', false], ['[data-value=yes]', 'commuteRanges', true], ['[data-testid=setup-primary]', 'exercise', false],
    ['[data-value=yes]', 'exerciseRanges', true], ['[data-testid=setup-primary]', 'more', false]]
  for (const [selector, next, hasPickers] of steps) {
    await live(page).locator(selector).click()
    await onScreen(page, next)
    await visit(next)
    if (hasPickers) await pickers(next)
  }
  await live(page).locator('[data-chip=family]').click()
  if (options.custom) {
    await live(page).getByTestId('more-other').click()
    await live(page).getByTestId('more-other-name').fill(options.custom)
    await visit('more, a name being typed')
    await page.keyboard.press('Enter')
  }
  await visit('more, chosen')
  await live(page).locator('[data-testid=setup-primary]').click()
  await onScreen(page, 'extra:family')
  await visit('extra:family')
  if (options.custom) {
    await live(page).locator('[data-testid=setup-primary]').click()
    await expect(setup(page)).toHaveAttribute('data-screen', /^extra:custom/)
    await visit('extra: the person\'s own')
  }
  await live(page).locator('[data-testid=setup-primary]').click()
  await onScreen(page, 'summary')
  await visit('summary')
  await live(page).getByTestId('card-work').click()
  await visit('summary, a card open')
  await live(page).locator('[data-category=work] [data-field=start]').first().click()
  await visit('summary, a picker open')
}

for (const size of [{ width: 390, height: 844 }, { width: 320, height: 640 }]) {
  test(`A27: every control is at least 48x48, 8 px from its neighbours and reachable at its centre (${size.width}x${size.height})`, async ({ page }) => {
    await start(page, { size })
    await page.goto('./')
    const problems: string[] = []
    await walk(page, async (label) => {
      await calm(page)
      for (const problem of await targetProblems(page)) problems.push(`${label}: ${problem.what} ${problem.problem}`)
    })
    expect([...new Set(problems)]).toEqual([])
  })
}

for (const theme of ['light', 'dark'] as const) {
  test(`A28: 320x640 at 200 % text in German (${theme}): nothing overflows sideways, the main button stays in view, nothing is clipped`, async ({ page }) => {
    await start(page, { size: { width: 320, height: 640 }, theme, language: 'de' })
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => { document.documentElement.style.fontSize = '200%' })
    })
    await page.goto('./')
    const problems: string[] = []
    await walk(page, async (label) => {
      await calm(page)
      const layout = await page.evaluate(() => {
        const sideways = Array.from(document.querySelectorAll<HTMLElement>('[role=dialog] .setup-scroller, [role=dialog] .dock-answer')).map((element) => element.scrollWidth - element.clientWidth)
        const primary = document.querySelector<HTMLElement>('[data-testid=setup] section.screen:not([aria-hidden=true]) [data-primary]')
        const rect = primary?.getBoundingClientRect()
        return {
          sheet: Math.max(0, ...sideways),
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          primary: rect ? rect.top >= 0 && rect.bottom <= window.innerHeight + 0.5 && rect.left >= 0 && rect.right <= window.innerWidth + 0.5 : true,
        }
      })
      if (layout.sheet > 0) problems.push(`${label}: the sheet scrolls sideways by ${layout.sheet} px`)
      if (layout.page > 0) problems.push(`${label}: the page scrolls sideways by ${layout.page} px`)
      if (!layout.primary) problems.push(`${label}: the main button is out of view`)
      for (const violation of await visualIntegrityViolations(page)) problems.push(`${label}: ${violation}`)
    }, { custom: 'Schwimmkurs mit den Kindern am Nachmittag im Hallenbad der Stad' })
    expect([...new Set(problems)]).toEqual([])
  })
}

test('A29: with the on-screen keyboard up, the name field and the main button are both in view', async ({ page }) => {
  await start(page)
  await page.goto('./')
  await tap(page, 'Lo veo después')
  await tap(page, 'Lo veo después')
  await tap(page, 'Lo veo después')
  await onScreen(page, 'more')
  await live(page).getByTestId('more-other').click()
  const field = live(page).getByTestId('more-other-name')
  await field.focus()
  // A keyboard proxy: the visible viewport shrinks to 360 px.
  await page.setViewportSize({ width: 390, height: 360 })
  await page.waitForTimeout(300)
  await calm(page)
  const inView = async (locator: ReturnType<typeof live>) => {
    const box = (await locator.boundingBox())!
    const height = await page.evaluate(() => window.visualViewport?.height ?? window.innerHeight)
    return box.y >= 0 && box.y + box.height <= height + 0.5
  }
  expect(await inView(field)).toBe(true)
  expect(await inView(primary(page))).toBe(true)
})

test('A13: valid legacy content (31 categories, 11 ranges in one, two equal names) saves unchanged, and one edit changes only its block', async ({ page }) => {
  const categories = Array.from({ length: 31 }, (_, index) => ({ id: `c-${index}`, name: index < 2 ? 'Igual' : `Cosa ${index}`, colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }))
  const many = Array.from({ length: 11 }, (_, index) => ({ id: `b-many-${index}`, categoryId: 'c-2', title: 'Cosa 2', days: [index % 7], start: 60 * (index % 3), end: 60 * (index % 3) + 30 }))
  const one = categories.filter((_, index) => index !== 2).map((category, index) => ({ id: `b-${category.id}`, categoryId: category.id, title: category.name, days: [index % 7], start: 300 + 30 * Math.floor(index / 7), end: 315 + 30 * Math.floor(index / 7) }))
  const document = storedDoc({ categories, blocks: [...many, ...one] })
  await start(page, { document })
  await page.goto('./')
  await openFromSettings(page)
  await onScreen(page, 'summary')
  const before = await bytes(page)
  await primary(page).click()
  await expect(setup(page)).toHaveCount(0)
  expect(await bytes(page)).toEqual(before)

  await openFromSettings(page)
  const card = live(page).locator('[data-category]').filter({ hasText: 'Cosa 30' })
  await card.getByRole('button', { expanded: false }).first().click()
  await card.locator('[data-field=end]').first().click()
  const option = card.locator('.times [data-minute]').nth(1)
  const minute = Number(await option.getAttribute('data-minute'))
  await option.click()
  await primary(page).click()
  await expect(setup(page)).toHaveCount(0)
  const original = JSON.parse(before.document!) as Doc
  const after = await stored(page)
  expect(after.revision).toBe(original.revision + 1)
  expect(after.categories).toEqual(original.categories)
  expect(after.blocks).toEqual(original.blocks.map((block) => (block.id === 'b-c-30' ? { ...block, end: minute } : block)))
})

test.describe('reduced motion', () => {
  async function exercise(page: Page): Promise<void> {
    await page.goto('./')
    await onScreen(page, 'sleep')
    await calm(page)
    await installMotionSampler(page, '[data-testid=setup]')
    const press = async (locator: ReturnType<typeof live>) => {
      const box = (await locator.boundingBox())!
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.waitForTimeout(150)
      await page.mouse.up()
    }
    await press(primary(page))
    await onScreen(page, 'workStudy')
    await press(live(page).locator('[data-value=work]'))
    await onScreen(page, 'work')
    await live(page).locator('[data-field=days]').click()
    await page.waitForTimeout(200)
    await live(page).getByTestId('range-add').click()
    await live(page).getByTestId('range-remove').last().click()
    await page.waitForTimeout(200)
    await live(page).locator('[data-answer=workStudy]').click()
    await onScreen(page, 'workStudy')
    await page.waitForTimeout(400)
  }

  test('A35: with reduced motion nothing in the setup moves by transform', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await start(page)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await exercise(page)
    expect(await collectMotion(page)).toEqual({ transforms: [], animations: [] })
  })

  test('A35: without it, the same sampler sees the screens slide (the sampler works)', async ({ page }) => {
    await start(page)
    await exercise(page)
    const motion = await collectMotion(page)
    expect(motion.transforms.length).toBeGreaterThan(0)
    expect(motion.animations.length).toBeGreaterThan(0)
  })
})

// ---------- The conversation: earlier answers stay, can be changed, and survive a reload ----------

test.describe('the conversation', () => {
  const turns = (page: Page) => live(page).locator('[data-answer]')

  test('changing an earlier answer while later ones exist drops what no longer applies, and the same answer brings it back', async ({ page }) => {
    await start(page)
    await page.goto('./')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Las dos cosas')
    await onScreen(page, 'work')
    await live(page).locator('[data-field=end]').click()
    await live(page).locator('[data-minute="1080"]').click()
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Enviar respuesta')
    await onScreen(page, 'commute')
    // The trip is phrased from the answers before it and starts from the work hours just given.
    await expect(live(page).getByRole('heading', { level: 3 })).toHaveText('¿Te toma tiempo ir al trabajo o a clase?')
    await tap(page, 'Sí')
    await onScreen(page, 'commuteRanges')
    await expect(live(page).locator('[data-field=start] .value').first()).toHaveText('8:30 a. m.')
    await expect(turns(page)).toHaveCount(5)
    await expect(live(page).locator('[data-answer=work] .turn-answer')).toHaveText('Lunes a viernes · 9:00 a. m.–6:00 p. m.')

    await live(page).locator('[data-answer=workStudy]').click()
    await onScreen(page, 'workStudy')
    await expect(turns(page)).toHaveCount(1)
    await tap(page, 'Ninguna')
    await onScreen(page, 'exercise')
    await expect(live(page).locator('[data-answer]')).toHaveText([/Todas las noches/, /Ninguna/])

    await live(page).getByRole('button', { name: 'Cambiar: ¿Trabajas o estudias? Ninguna' }).click()
    await tap(page, 'Las dos cosas')
    await onScreen(page, 'work')
    await expect(live(page).locator('[data-field=end] .value')).toHaveText('6:00 p. m.')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Enviar respuesta')
    await onScreen(page, 'commute')
    await expect(live(page).getByRole('button', { name: 'Sí (actual)' })).toBeVisible()
  })

  test('a reload in the middle brings back the whole conversation and the question on show', async ({ page }) => {
    await start(page)
    await page.goto('./')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'Trabajo')
    await tap(page, 'Enviar respuesta')
    await tap(page, 'No')
    await tap(page, 'Lo veo después')
    await onScreen(page, 'more')
    const before = await turns(page).allTextContents()
    expect(before).toHaveLength(5)
    await page.reload()
    await onScreen(page, 'more')
    await expect(turns(page)).toHaveText(before)
    await expect(live(page).getByRole('heading', { level: 3 })).toHaveText('¿A qué más le dedicas tiempo cada semana?')
  })

  test('by keyboard alone: Enter sends, focus moves to the next answer, Tab reaches an earlier answer and Enter reopens it, Escape leaves without writing', async ({ page }) => {
    await start(page, { document: firstRun() })
    await page.goto('./')
    await onScreen(page, 'sleep')
    await expect(live(page).getByRole('heading', { level: 3 })).toBeFocused()
    const before = await bytes(page)
    await page.keyboard.press('Enter')
    await onScreen(page, 'workStudy')
    // The next answer is in reach: focus is on the first reply, which is described by its question.
    await expect(live(page).getByRole('button', { name: 'Trabajo', exact: true })).toBeFocused()
    await page.keyboard.press('Shift+Tab')
    await expect(live(page).locator('[data-answer=sleep]')).toBeFocused()
    await page.keyboard.press('Enter')
    await onScreen(page, 'sleep')
    await page.keyboard.press('Escape')
    await expect(setup(page)).toHaveCount(0)
    expect(await bytes(page)).toEqual(before)
  })
})
