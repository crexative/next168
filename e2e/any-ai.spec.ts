import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { V2_KEY, seedKey } from './fixtures'
import { storedPlanner, storedRecord } from './support/indexedDb'
import { visualIntegrityViolations } from './support/visualIntegrity'
import { SYNTHETIC_RANGE_COUNT, syntheticWeekReply } from '../src/features/assistant/anyAi/syntheticWeek'

// "Usar con tu IA" (#3): copy a prompt, paste the AI's whole reply, review and approve. Spanish, 390x844 and
// 1440x900, both themes. The browser never talks to an AI: the clipboard is stubbed and replies are typed in.
test.use({ locale: 'es-CO', launchOptions: { args: ['--disable-features=WebGPU'] } })

// Wednesday 2026-10-21 10:07 UTC; the browser and the document both use UTC.
const NOW = new Date('2026-10-21T10:07:00.000Z')
const THEMES = ['light', 'dark'] as const
const SIZES = { phone: { width: 390, height: 844 }, desktop: { width: 1440, height: 900 } } as const
const WORKSPACE = 'workspace-any-ai'

function plannerDocument() {
  return {
    schemaVersion: 2, workspaceId: WORKSPACE, revision: 1, updatedAt: '2026-10-20T08:00:00.000Z',
    settings: { locale: 'es', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [
      { id: 'c-work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
      { id: 'c-sleep', name: 'Sueño', colorKey: 'purple', goal: { type: 'min', hoursPerWeek: 49 } },
      { id: 'c-exercise', name: 'Ejercicio', colorKey: 'green', goal: { type: 'min', hoursPerWeek: 3 } },
    ],
    blocks: [
      { id: 'b-work', categoryId: 'c-work', title: 'Trabajo profundo', days: [1, 2, 3, 4, 5], start: 540, end: 780 },
      { id: 'b-sleep', categoryId: 'c-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 },
      { id: 'b-gym', categoryId: 'c-exercise', title: 'Gimnasio', days: [2], start: 1080, end: 1140 },
    ],
    tasks: [{ id: 't-report', title: 'Informe trimestral', categoryId: 'c-work', durationMin: 90, priority: 1, createdAt: '2026-10-20T08:00:00.000Z' }],
    checkIns: [], actuals: [],
    events: [{ id: 'e-review', title: 'Revisión de diseño', start: '2026-10-22T14:00:00.000Z', end: '2026-10-22T15:00:00.000Z', allDay: false, attendees: [] }],
    calendarSources: [], appliedProposalIds: [],
  }
}

// What ChatGPT typically answers: friendly prose around one fenced block.
function chatGptReply(overrides: Record<string, unknown> = {}): string {
  const proposal = {
    contractVersion: '1.1', workspaceId: WORKSPACE, baseRevision: 1, summary: 'Mover el gimnasio del martes al jueves',
    ops: [{ op: 'update_block', id: 'b-gym', patch: { days: [4] } }], ...overrides,
  }
  return `¡Claro! Mover el gimnasio al jueves deja libre tu martes por la tarde y el jueves a esa hora no tienes nada.

\`\`\`weeklid
${JSON.stringify(proposal, null, 2)}
\`\`\`

Cuando lo apruebes en Weeklid, el gimnasio quedará el jueves de 18:00 a 19:00. ¿Quieres que revise también el fin de semana?`
}

// The planner of a person who skipped the first-run setup ("Ahora no"): nothing in it yet.
function emptyPlanner() {
  return { ...plannerDocument(), categories: [], blocks: [], tasks: [], events: [] }
}

async function begin(page: Page, theme: (typeof THEMES)[number], size: keyof typeof SIZES, options: { clipboard?: boolean; document?: object } = {}): Promise<void> {
  await page.setViewportSize(SIZES[size])
  await page.emulateMedia({ colorScheme: theme })
  await page.clock.install({ time: NOW })
  await page.addInitScript(([clipboard]) => {
    window.localStorage.setItem('next168-language', 'es')
    const copied: string[] = []
    ;(window as unknown as { __copied: string[] }).__copied = copied
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: clipboard ? { writeText: async (text: string) => { copied.push(text) } } : undefined })
  }, [options.clipboard !== false] as const)
  await seedKey(page, V2_KEY, JSON.stringify(options.document ?? plannerDocument()))
}

const copiedTexts = (page: Page) => page.evaluate(() => (window as unknown as { __copied: string[] }).__copied)

async function settled(page: Page): Promise<void> {
  await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
  await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
}

// The way a person gets there: the assistant entry (the toolbar icon on a phone, the sidebar footer row on wider
// screens), then the "Usar con tu IA" row.
async function openFromAssistant(page: Page): Promise<void> {
  await page.goto('./#/today')
  if (page.viewportSize()!.width < 768) await page.getByTestId('assistant-entry').click()
  else await page.getByTestId('sidebar-footer').getByRole('link', { name: 'Asistente' }).click()
  await expect(page.getByRole('heading', { level: 1, name: 'Asistente' })).toBeVisible()
  await settled(page)
  await page.getByRole('button', { name: /Usar con tu IA/ }).click()
  await expect(page.getByTestId('any-ai-copy')).toBeVisible()
}

async function noViolations(page: Page, state: string): Promise<void> {
  await settled(page)
  expect.soft(await visualIntegrityViolations(page), state).toEqual([])
}

const box = (page: Page) => page.getByTestId('any-ai-paste')

for (const theme of THEMES) {
  for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
    test.describe(`use with your AI (${size}, ${theme})`, () => {
      test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'sizes are set by the spec; one project is enough') })

      test('the assistant page offers it, and copying puts a short Spanish prompt on the clipboard', async ({ page }) => {
        await begin(page, theme, size)
        await openFromAssistant(page)
        await expect(page.getByTestId('any-ai').getByRole('listitem')).toHaveCount(3)
        await noViolations(page, `${theme}/${size}/assistant with the panel open`)
        await page.getByTestId('any-ai-copy').click()
        await expect(page.getByTestId('any-ai-copied')).toHaveText('Copiado. Ahora pégalo en tu chat.')
        const [text] = await copiedTexts(page)
        expect(text).toContain('Weeklid es un planificador semanal privado')
        expect(text).toContain(`workspaceId="${WORKSPACE}" revision=1`)
        expect(text).toContain('"Gimnasio" [category="c-exercise"]: mar 18:00-19:00 [id="b-gym"')
        expect(text).toContain('2026-10-22 14:00-15:00 "Revisión de diseño"')
        expect(text).toContain('"Informe trimestral" 90 min')
        expect(text.length).toBeLessThan(6000)
        await noViolations(page, `${theme}/${size}/copied`)
      })

      test('Settings has the same panel; the local Claude option only appears where its companion runs', async ({ page }) => {
        await begin(page, theme, size)
        await page.goto('./#/settings')
        await page.getByTestId('ai-link').click()
        await expect(page).toHaveURL(/#\/settings\/ai$/)
        await expect(page.getByTestId('any-ai-copy')).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Claude Desktop o Claude Code (en este equipo)' })).toHaveCount(0)
        await expect(page.getByTestId('any-ai-toggle')).not.toHaveAttribute('aria-expanded', /.*/)
        await noViolations(page, `${theme}/${size}/settings connect section`)
      })

      test('without a clipboard the text is shown to copy by hand', async ({ page }) => {
        await begin(page, theme, size, { clipboard: false })
        await openFromAssistant(page)
        await page.getByTestId('any-ai-copy').click()
        await expect(page.getByTestId('any-ai-manual')).toBeVisible()
        await expect(page.getByTestId('any-ai-manual')).toHaveValue(new RegExp(`workspaceId="${WORKSPACE}" revision=1`))
        await expect(page.getByTestId('any-ai-copied')).toHaveCount(0)
        await noViolations(page, `${theme}/${size}/manual copy`)
      })

      test('a ChatGPT-style reply that moves the gym to Thursday: review, approve, and Week shows it', async ({ page }) => {
        await begin(page, theme, size)
        await openFromAssistant(page)
        await expect(page.getByTestId('any-ai-review')).toBeDisabled()
        await box(page).fill(chatGptReply())
        await page.getByTestId('any-ai-review').click()

        const review = page.getByTestId('proposal-review')
        await expect(review).toBeVisible()
        await expect(review).toContainText('Mover el gimnasio del martes al jueves')
        await expect(review.getByTestId('change-before')).toContainText('mar')
        await expect(review.getByTestId('change-after')).toContainText('jue')
        // Nothing is applied before approval.
        expect((await storedPlanner<{ revision: number; blocks: { id: string; days: number[] }[] }>(page)).revision).toBe(1)
        await noViolations(page, `${theme}/${size}/review of a pasted reply`)

        await page.getByTestId('review-approve').click()
        await expect(page.getByTestId('proposal-review')).toHaveCount(0)
        const stored = await storedPlanner<{ revision: number; blocks: { id: string; days: number[] }[] }>(page)
        expect(stored.revision).toBe(2)
        expect(stored.blocks.find((block) => block.id === 'b-gym')!.days).toEqual([4])

        await page.goto('./#/week')
        await expect(page.getByRole('heading', { level: 1, name: 'Semana' })).toBeVisible()
        if (size === 'phone') await page.getByTestId('week-view-toggle').click()
        await expect(page.locator('.day-column[data-date="2026-10-22"] [data-block-id="b-gym"]')).toHaveCount(1)
        await expect(page.locator('.day-column[data-date="2026-10-20"] [data-block-id="b-gym"]')).toHaveCount(0)
      })

      test('a reply without changes gets a friendly error that says what to ask', async ({ page }) => {
        await begin(page, theme, size)
        await openFromAssistant(page)
        await box(page).fill('Claro, yo movería el gimnasio al jueves. ¿Algo más?')
        await page.getByTestId('any-ai-review').click()
        await expect(page.getByTestId('any-ai-error')).toContainText('Tu IA respondió sin cambios para Weeklid: quizá solo conversó o necesita algo de ti antes. Lee su mensaje. Para cambiar tu plan, pídele: «dame los cambios en el bloque weeklid».')
        await expect(page.getByTestId('any-ai-reply-start')).toHaveText('Claro, yo movería el gimnasio al jueves. ¿Algo más?')
        await expect(page.getByRole('alert')).toBeVisible()
        await expect(page.getByTestId('proposal-review')).toHaveCount(0)
        await expect(box(page)).toHaveValue(/movería el gimnasio/)
        await noViolations(page, `${theme}/${size}/no proposal found`)
        for (const garbage of ['{"ops": [', '```weeklid\n{"contractVersion": "9"}\n```']) {
          await box(page).fill(garbage)
          await page.getByTestId('any-ai-review').click()
          await expect(page.getByTestId('any-ai-error')).toBeVisible()
        }
        expect((await storedPlanner<{ revision: number }>(page)).revision).toBe(1)
      })

      test('a reply made before the plan changed is refused, and "Copiar de nuevo" copies the current plan', async ({ page }) => {
        await begin(page, theme, size)
        await openFromAssistant(page)
        await page.getByTestId('any-ai-copy').click()
        await expect(page.getByTestId('any-ai-copied')).toBeVisible()
        // The plan changes after the copy: a task is added.
        await page.goto('./#/tasks')
        await expect(page.getByRole('heading', { level: 1, name: 'Tareas' })).toBeVisible()
        await page.locator('form.add input[type=text]').fill('Llamar al banco')
        await page.locator('form.add input[type=text]').press('Enter')
        await expect.poll(async () => (await storedPlanner<{ revision: number }>(page)).revision).toBe(2)

        await openFromAssistant(page)
        await box(page).fill(chatGptReply())
        await page.getByTestId('any-ai-review').click()
        await expect(page.getByTestId('any-ai-error')).toContainText('Tu plan cambió después de copiarlo para tu IA.')
        await expect(page.getByTestId('proposal-review')).toHaveCount(0)
        await noViolations(page, `${theme}/${size}/stale reply`)
        await page.getByTestId('any-ai-copy-again').click()
        await expect.poll(async () => (await copiedTexts(page)).length).toBe(2)
        const fresh = (await copiedTexts(page))[1]!
        expect((await copiedTexts(page))[0]).toContain(`workspaceId="${WORKSPACE}" revision=1`)
        expect(fresh).toContain(`workspaceId="${WORKSPACE}" revision=2`)
        expect(fresh).toContain('"Llamar al banco"')
        await expect(page.getByTestId('any-ai-error')).toHaveCount(0)
        expect((await storedPlanner<{ blocks: { id: string; days: number[] }[] }>(page)).blocks.find((block) => block.id === 'b-gym')!.days).toEqual([2])
      })

      test('a reply for another plan is refused', async ({ page }) => {
        await begin(page, theme, size)
        await openFromAssistant(page)
        await box(page).fill(chatGptReply({ workspaceId: 'otro-plan' }))
        await page.getByTestId('any-ai-review').click()
        await expect(page.getByTestId('any-ai-error')).toContainText('Estos cambios son de otro plan.')
        await expect(page.getByTestId('any-ai-copy-again')).toBeVisible()
        await expect(page.getByTestId('proposal-review')).toHaveCount(0)
      })
    })
  }
}

// The whole week of another planner into an EMPTY Weeklid in one round trip (#3). The reply is a recorded, realistic
// chat answer built from a synthetic week of the owner's size (8 categories, 85 ranges, 3 tasks); the browser never
// talks to an AI. Only the workspace and revision, which the AI copies from the prompt, are filled in from the copy.
const promptBinding = (text: string) => {
  const match = /workspaceId=("(?:[^"\\]|\\.)*") revision=(\d+)/.exec(text)!
  return { workspaceId: JSON.parse(match[1]!) as string, revision: Number(match[2]) }
}

for (const size of Object.keys(SIZES) as (keyof typeof SIZES)[]) {
  test.describe(`a whole week into an empty planner (${size})`, () => {
    test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'sizes are set by the spec; one project is enough') })

    test('one paste creates the 8 categories, 85 routine ranges and 3 tasks; Summary shows all 168 hours', async ({ page }) => {
      await begin(page, 'light', size, { document: emptyPlanner() })
      await openFromAssistant(page)
      await expect(page.getByTestId('any-ai-empty-hint')).toHaveText('Aún no tienes categorías: tu IA puede crearlas en los mismos cambios que te proponga.')
      await page.getByTestId('any-ai-copy').click()
      const [prompt] = await copiedTexts(page)
      expect(prompt).toContain('{"op":"add_category"')
      const binding = promptBinding(prompt!)
      await box(page).fill(syntheticWeekReply(binding.workspaceId, binding.revision))
      await page.getByTestId('any-ai-review').click()

      await expect(page.getByTestId('review-overview')).toHaveText('8 categorías nuevas · 32 rutinas · 3 tareas')
      // Approve is in the footer, on screen without scrolling the 43 changes.
      await expect(page.getByTestId('review-approve')).toBeEnabled()
      await expect(page.getByTestId('review-approve')).toBeInViewport({ ratio: 1 })
      await expect(page.getByTestId('review-cancel')).toBeInViewport({ ratio: 1 })
      expect((await storedPlanner<{ categories: unknown[] }>(page)).categories).toHaveLength(0)
      await noViolations(page, `${size}/review of a whole week`)
      // A double tap applies it once.
      await page.getByTestId('review-approve').dblclick()
      await expect(page.getByTestId('proposal-review')).toHaveCount(0)

      const stored = await storedPlanner<{ revision: number; categories: { id: string; name: string; colorKey: string }[]; blocks: { categoryId: string; days: number[]; start: number; end: number }[]; tasks: { categoryId: string }[] }>(page)
      expect(stored.revision).toBe(binding.revision + 1)
      expect(stored.categories.map((category) => category.name)).toEqual(['Sueño', 'Trabajo', 'Ejercicio', 'Comer y cocinar', 'Proyecto personal', 'Familia y amigos', 'Aprender', 'Rutinas y casa'])
      expect(new Set(stored.categories.map((category) => category.colorKey)).size).toBe(8)
      expect(stored.blocks.reduce((sum, block) => sum + block.days.length, 0)).toBe(SYNTHETIC_RANGE_COUNT)
      expect(SYNTHETIC_RANGE_COUNT).toBe(85)
      expect(stored.blocks.filter((block) => block.end < block.start)).toHaveLength(2)
      expect(stored.tasks).toHaveLength(3)
      const ids = new Set(stored.categories.map((category) => category.id))
      expect([...stored.blocks, ...stored.tasks].every((item) => ids.has(item.categoryId))).toBe(true)
      await expect(page.getByTestId('proposal-badge')).toHaveCount(0)
      await expect(box(page)).toHaveValue('')

      await page.goto('./#/insights')
      await expect(page.getByTestId('capacity-available')).toHaveText('168 h asignadas · 0 h sin asignar')
      await page.goto('./#/tasks')
      await expect(page.getByText('Confirmar cantidades del mercado')).toBeVisible()
    })

    test('cancelling the review discards the pasted changes: no pending proposal, and the reply is still there to review again', async ({ page }) => {
      await begin(page, 'light', size, { document: emptyPlanner() })
      await openFromAssistant(page)
      await page.getByTestId('any-ai-copy').click()
      const binding = promptBinding((await copiedTexts(page))[0]!)
      const reply = syntheticWeekReply(binding.workspaceId, binding.revision)
      await box(page).fill(reply)
      await page.getByTestId('any-ai-review').click()
      await expect(page.getByTestId('review-cancel-note')).toHaveText('Si cancelas, estos cambios se descartan y tu plan queda como está.')
      await page.getByTestId('review-cancel').click()
      await expect(page.getByTestId('proposal-review')).toHaveCount(0)
      await expect.poll(async () => (JSON.parse(await storedRecord(page, 'proposals') ?? '[]') as { status: string }[]).map((proposal) => proposal.status)).toEqual(['rejected'])
      await expect(page.getByTestId('proposal-badge')).toHaveCount(0)
      expect((await storedPlanner<{ categories: unknown[] }>(page)).categories).toHaveLength(0)
      await expect(box(page)).toHaveValue(reply)
      await page.getByTestId('any-ai-review').click()
      await expect(page.getByTestId('review-overview')).toHaveText('8 categorías nuevas · 32 rutinas · 3 tareas')
    })

    test('approving after another tab changed the plan is refused and creates nothing', async ({ page, context }) => {
      await begin(page, 'light', size, { document: emptyPlanner() })
      await openFromAssistant(page)
      await page.getByTestId('any-ai-copy').click()
      const binding = promptBinding((await copiedTexts(page))[0]!)
      await box(page).fill(syntheticWeekReply(binding.workspaceId, binding.revision))
      await page.getByTestId('any-ai-review').click()
      await expect(page.getByTestId('review-approve')).toBeEnabled()

      const other = await context.newPage()
      await other.goto('./#/tasks')
      await expect(other.getByRole('heading', { level: 1, name: 'Tareas' })).toBeVisible()
      await other.locator('form.add input[type=text]').fill('Llamar al banco')
      await other.locator('form.add input[type=text]').press('Enter')
      await expect.poll(async () => (await storedPlanner<{ revision: number }>(other)).revision).toBe(binding.revision + 1)

      await page.getByTestId('review-approve').click()
      await expect(page.getByTestId('proposal-review')).toContainText('Tu plan cambió.')
      await expect(page.getByTestId('review-approve')).toBeDisabled()
      const stored = await storedPlanner<{ categories: unknown[]; tasks: unknown[] }>(page)
      expect(stored.categories).toHaveLength(0)
      expect(stored.tasks).toHaveLength(1)
      await other.close()
    })
  })
}


// verify4 defect 1: on a profile that never stored anything (first run, "Ahora no"), a real reply could never be saved
// ("No se pudieron guardar los cambios"), even after a retry and a reload. The reply is Claude's, recorded by the
// verifier for this very prompt; only its workspace id is replaced with this profile's.
test.describe('a truly empty profile', () => {
  test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name !== 'desktop', 'one project is enough') })

  const recordedReply = (workspaceId: string) => readFileSync(new URL('./recorded/claude-reply-empty-profile.txt', import.meta.url), 'utf8').replace('{{workspaceId}}', workspaceId)

  test('"Ahora no", copy, paste a real reply, reload, review and approve: the plan is created', async ({ page }) => {
    await page.setViewportSize(SIZES.phone)
    await page.clock.install({ time: NOW })
    await page.addInitScript(() => {
      window.localStorage.setItem('next168-language', 'es')
      const copied: string[] = []
      ;(window as unknown as { __copied: string[] }).__copied = copied
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => { copied.push(text) } } })
    })
    await page.goto('./#/today')
    await page.getByRole('button', { name: 'Ahora no' }).click()
    expect(await storedRecord(page, 'document')).toBeNull()

    await openFromAssistant(page)
    await page.getByTestId('any-ai-copy').click()
    const binding = promptBinding((await copiedTexts(page))[0]!)
    expect(binding.revision).toBe(0)
    await box(page).fill(recordedReply(binding.workspaceId))
    await page.getByTestId('any-ai-review').click()
    await expect(page.getByTestId('review-overview')).toHaveText('9 categorías nuevas · 17 rutinas · 2 tareas')
    await expect(page.getByTestId('review-invalid')).toHaveCount(0)
    expect(await storedRecord(page, 'document')).toBeNull()

    // A reload in the middle keeps the same unsaved plan, so the same reply still fits it.
    await page.reload()
    await expect(page.getByRole('button', { name: 'Ahora no' })).toHaveCount(0)
    await openFromAssistant(page)
    await box(page).fill(recordedReply(binding.workspaceId))
    await page.getByTestId('any-ai-review').click()
    await expect(page.getByTestId('review-overview')).toHaveText('9 categorías nuevas · 17 rutinas · 2 tareas')
    await page.getByTestId('review-approve').click()
    await expect(page.getByTestId('proposal-review')).toHaveCount(0)
    await expect(page.getByText('No se pudieron guardar los cambios')).toHaveCount(0)

    const stored = await storedPlanner<{ workspaceId: string; revision: number; categories: { name: string }[]; tasks: { title: string }[] }>(page)
    expect(stored).toMatchObject({ workspaceId: binding.workspaceId, revision: 1 })
    expect(stored.categories).toHaveLength(9)
    expect(stored.tasks.map((task) => task.title)).toEqual(['Preparar presentación trimestral', 'Renovar pasaporte'])
    await page.goto('./#/insights')
    await expect(page.getByTestId('capacity-available')).toContainText('h asignadas')
  })
})
