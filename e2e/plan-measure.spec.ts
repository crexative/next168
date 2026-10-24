import { readFileSync, writeFileSync } from 'node:fs'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'
import { LEGACY_BLOCK_COUNT, legacyData, openAdvanced, openTab, seedKey, V2_KEY } from './fixtures'
import { storedPlanner, storedRecord } from './support/indexedDb'

const LEGACY_KEYS = ['next168-data', 'next168-v2', 'next168-v2-backup', 'next168-v2-proposals', 'next168-tutorial-completed']
// Device preferences kept beside the planner (export nudge, storage protection, last task category).
const PREFERENCE_KEYS = ['next168-last-export', 'next168-first-seen', 'next168-export-snoozed', 'next168-persist-requested', 'next168-last-task-category', 'next168-appearance']

const MONDAY_MORNING = new Date('2026-10-26T08:00:00Z')

const sleep = { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } }
const work = { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } }
const study = { id: 'c-study', name: 'Study', colorKey: 'orange', goal: { type: 'none', hoursPerWeek: 0 } }
const spare = { id: 'c-spare', name: 'Spare', colorKey: 'gray', goal: { type: 'none', hoursPerWeek: 0 } }

function plannerDocument(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    workspaceId: 'ws-e2e',
    revision: 1,
    updatedAt: '2026-10-20T10:00:00.000Z',
    settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
    categories: [sleep, work, study, spare],
    blocks: [
      { id: 'b-sleep', categoryId: 'c-sleep', title: 'Sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 23 * 60, end: 7 * 60 },
      { id: 'b-work', categoryId: 'c-work', title: 'Work', days: [1, 2, 3, 4, 5], start: 9 * 60, end: 18 * 60 },
      { id: 'b-study', categoryId: 'c-study', title: 'Study', days: [2], start: 19 * 60, end: 20 * 60 },
    ],
    tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
    ...overrides,
  }
}

async function startWith(page: Page, document: unknown): Promise<void> {
  await page.clock.setFixedTime(MONDAY_MORNING)
  await seedKey(page, V2_KEY, JSON.stringify(document))
}

async function storedDocument(page: Page) {
  return storedPlanner(page)
}

function withoutBookkeeping(document: Record<string, unknown>) {
  const content = { ...document }
  delete content.revision
  delete content.updatedAt
  return content
}

test.describe('plan and measure', () => {
  test('@smoke a fresh profile gets onboarding with templates and ends with a populated week', async ({ page }) => {
    await page.clock.setFixedTime(MONDAY_MORNING)
    await page.goto('./')
    const dialog = page.getByRole('dialog', { name: 'Your typical week' })
    await expect(dialog).toBeVisible()

    // Sleep and Work come ticked.
    await expect(dialog.getByRole('checkbox', { name: 'Use Sleep' })).toBeChecked()
    await expect(dialog.getByRole('checkbox', { name: 'Use Work' })).toBeChecked()
    await dialog.getByRole('checkbox', { name: 'Use Exercise' }).check()
    await expect(page.getByTestId('week-counter')).toHaveText(/^99 h assigned · 69 h unassigned$/)
    // Tapping a routine opens the Week editor: rename Work.
    await dialog.getByRole('button', { name: /^Edit Work:/ }).click()
    const editor = page.getByRole('dialog', { name: 'Edit block' })
    await editor.getByLabel('Title').fill('Day job')
    await editor.getByRole('button', { name: 'Save' }).click()
    await dialog.getByRole('button', { name: 'Next' }).click()

    await expect(page.getByRole('dialog', { name: 'Your first task' })).toBeVisible()
    await page.getByLabel('Task', { exact: true }).fill('Book a health check')
    await page.getByRole('button', { name: 'Finish' }).click()
    await expect(page.getByRole('dialog', { name: 'All set' })).toBeVisible()
    await page.getByTestId('onboarding').getByRole('button', { name: 'Get started' }).click()
    await expect(page.getByTestId('onboarding')).toBeHidden()

    const document = await storedDocument(page)
    expect(document.settings.onboardingDone).toBe(true)
    expect(document.categories.map((category: { name: string }) => category.name)).toEqual(['Sleep', 'Day job', 'Exercise'])
    expect(document.categories[0].goal).toEqual({ type: 'min', hoursPerWeek: 49 })
    expect(document.blocks).toHaveLength(3)
    // The default category is the first one that is not Sleep, so the task never lands in the sleep block.
    expect(document.tasks[0]).toMatchObject({ title: 'Book a health check', categoryId: document.categories[1].id })

    await openTab(page, 'week')
    await expect(page.locator('main')).not.toBeEmpty()
    await openTab(page, 'insights')
    await expect(page.getByTestId('week-bar').locator('[data-segment]')).toHaveCount(4)
    await expect(page.getByTestId(`goal-row-${document.categories[0].id}`)).toContainText('On track')
  })

  test('skipping onboarding keeps the planner empty and marks it done', async ({ page }) => {
    await page.goto('./')
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByTestId('onboarding')).toBeHidden()
    expect((await storedDocument(page)).settings.onboardingDone).toBe(true)
    expect((await storedDocument(page)).categories).toEqual([])
  })

  test('a 2 h task in a category with 1 h free shows 1 h missing; complete can be undone', async ({ page }) => {
    await startWith(page, plannerDocument())
    await openTab(page, 'tasks')

    await page.getByLabel('Task', { exact: true }).fill('Write report')
    await page.getByLabel('Duration').selectOption('120')
    await page.getByLabel('Category').selectOption('c-study')
    await page.getByRole('button', { name: 'Add task' }).click()

    const warning = page.getByTestId('overflow-text')
    await expect(warning).toContainText('1 h missing in Study')
    await expect(page.getByTestId('placed-task')).toContainText('Write report')
    await expect(page.getByTestId('placed-task')).toContainText('7:00 PM–8:00 PM')

    await page.getByRole('button', { name: 'Complete Write report' }).click()
    await expect(page.getByTestId('done-task')).toContainText('Write report')
    await expect(page.getByTestId('task-warnings')).toBeHidden()
    const stored = await storedDocument(page)
    expect(stored.tasks[0].doneAt).toBeTruthy()

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect(page.getByTestId('done-task')).toHaveCount(0)
    await expect(warning).toContainText('1 h missing in Study')
    expect((await storedDocument(page)).tasks[0].doneAt).toBeUndefined()
  })

  test('a task due before its slot is flagged late with a suggestion', async ({ page }) => {
    await startWith(page, plannerDocument({
      tasks: [{ id: 't-late', title: 'Hand in form', categoryId: 'c-study', durationMin: 60, dueDate: '2026-10-26', priority: 1, createdAt: '2026-10-20T10:00:00.000Z' }],
    }))
    await openTab(page, 'tasks')
    await expect(page.getByTestId('late-text')).toContainText('after its due date')
    await expect(page.getByTestId('task-warnings')).toContainText('Move the due date')
  })

  test('insights shows the 168 hour bar, goal chips and an empty measures state that leads to the check-in', async ({ page }) => {
    await startWith(page, plannerDocument())
    await openTab(page, 'insights')
    const bar = page.getByTestId('week-bar')
    await expect(bar.locator('[data-segment]')).toHaveCount(4)
    await expect(page.getByTestId('capacity-available')).toHaveText('66 h available of 168')
    await expect(page.getByTestId('goal-row-c-work').getByTestId('goal-chip')).toHaveText(/Over cap/)
    await expect(page.getByTestId('goal-row-c-sleep').getByTestId('goal-chip')).toContainText('On track')
    await expect(page.getByTestId('measures-empty')).toContainText('day wrap-up')
    await page.getByRole('link', { name: "Do tonight's check-in" }).click()
    await expect(page).toHaveURL(/#\/checkin$/)
  })

  test('plan vs actual comes from recorded actuals', async ({ page }) => {
    await startWith(page, plannerDocument({
      actuals: [{
        date: '2026-10-25', blockId: 'b-work', categoryId: 'c-work', plannedStartAt: '2026-10-25T09:00:00.000Z', plannedEndAt: '2026-10-25T18:00:00.000Z',
        plannedMinutes: 540, status: 'partial', actualMinutes: 300,
      }],
    }))
    await openTab(page, 'insights')
    await expect(page.getByTestId('actual-row-c-work').getByTestId('actual-value')).toContainText('5 h of 9 h')
  })

  test('saving a check-in updates the sleep average in insights', async ({ page }) => {
    await startWith(page, plannerDocument())
    await openTab(page, 'insights')
    await expect(page.getByTestId('measure-sleep')).toHaveCount(0)

    await page.goto('./#/checkin')
    await expect(page.getByRole('heading', { level: 1, name: 'Day wrap-up' })).toBeVisible()
    await page.getByLabel('Bedtime').fill('23:00')
    await page.getByLabel('Wake-up').fill('07:00')
    await page.getByLabel('Work ended').fill('22:00')
    await page.getByRole('radio', { name: 'Yes' }).click()
    await page.getByRole('radio', { name: '4', exact: true }).click()
    await page.getByRole('button', { name: 'Save wrap-up' }).click()

    // Saving returns to Today; the measures are one tap away.
    await expect(page).toHaveURL(/#\/today$/)
    await openTab(page, 'insights')
    await expect(page.getByTestId('measure-sleep').getByTestId('measure-value')).toHaveText('8 h')
    await expect(page.getByTestId('measure-late-work').getByTestId('measure-value')).toHaveText('1')
    await expect(page.getByTestId('measure-stress').getByTestId('measure-value')).toHaveText('4.0')
    expect((await storedDocument(page)).checkIns).toEqual([{ date: '2026-10-26', bedtime: 1380, wake: 420, workEnd: 1320, exercise: 'yes', stress: 4 }])

    await page.goto('./#/checkin')
    await expect(page.getByLabel('Bedtime')).toHaveValue('23:00')
  })

  test('export, delete all and import restores an identical document', async ({ page }, testInfo) => {
    await startWith(page, plannerDocument({
      tasks: [{ id: 't-1', title: 'Write report', categoryId: 'c-study', durationMin: 60, priority: 2, createdAt: '2026-10-20T10:00:00.000Z' }],
      checkIns: [{ date: '2026-10-25', bedtime: 1380, wake: 420, stress: 2 }],
    }))
    await openAdvanced(page)
    await expect(page.getByTestId('data-mode')).toContainText('This browser')
    await expect(page.getByTestId('data-workspace')).toHaveText('ws-e2e')
    await openTab(page, 'settings')
    const before = withoutBookkeeping(await storedDocument(page))

    const downloadPromise = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export backup' }).click()
    const download = await downloadPromise
    expect(download.suggestedFilename()).toBe('next168-export-2026-10-26.json')
    const exportPath = testInfo.outputPath('export.json')
    await download.saveAs(exportPath)
    expect(JSON.parse(readFileSync(exportPath, 'utf8')).format).toBe('next168-export')

    await page.evaluate((keys) => keys.forEach((key) => window.localStorage.setItem(key, 'x')), PREFERENCE_KEYS)
    await page.getByRole('radiogroup', { name: 'Appearance' }).getByRole('radio', { name: 'Dark' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await page.getByRole('button', { name: 'Delete all data…' }).click()
    const dialog = page.getByRole('dialog', { name: 'Delete everything?' })
    const confirm = dialog.getByRole('button', { name: 'Delete everything' })
    await expect(confirm).toBeDisabled()
    await dialog.getByRole('textbox').fill('delete')
    await confirm.click()
    await expect(page.getByTestId('data-notice')).toContainText('All data was deleted')
    const wiped = await storedDocument(page)
    expect(wiped.categories).toEqual([])
    expect(wiped.workspaceId).not.toBe('ws-e2e')
    expect(await storedRecord(page, 'backup')).toBeNull()
    expect(await storedRecord(page, 'proposals')).toBeNull()
    expect(await page.evaluate((keys) => keys.filter((key) => window.localStorage.getItem(key) !== null), LEGACY_KEYS)).toEqual([])
    expect(await page.evaluate((keys) => keys.filter((key) => window.localStorage.getItem(key) !== null), PREFERENCE_KEYS)).toEqual([])
    // The open page goes back to the system's appearance at once.
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./)

    // A reload re-runs the seeding script, which writes next168-v2 again, as a kill can resurrect a removed key:
    // the planner stays empty and the key is removed again.
    await page.reload()
    await openAdvanced(page)
    await expect(page.getByTestId('data-workspace')).toHaveText(wiped.workspaceId)
    expect((await storedDocument(page)).categories).toEqual([])
    expect(await page.evaluate((keys) => keys.filter((key) => window.localStorage.getItem(key) !== null), LEGACY_KEYS)).toEqual([])
    await openTab(page, 'settings')

    await page.getByLabel('Choose a Next168 export file').setInputFiles(exportPath)
    await expect(page.getByTestId('import-preview')).toContainText('File schema version 2')
    await expect(page.getByTestId('count-tasks')).toHaveText('1 task')
    await page.getByRole('button', { name: 'Replace my data' }).click()
    await expect(page.getByTestId('data-notice')).toContainText('Imported and verified')

    const after = withoutBookkeeping(await storedDocument(page))
    expect(after).toEqual(before)
  })

  test('importing a v1 file migrates it after a preview', async ({ page }, testInfo) => {
    await startWith(page, plannerDocument())
    await openTab(page, 'settings')
    const v1Path = testInfo.outputPath('v1.json')
    writeFileSync(v1Path, JSON.stringify(legacyData))
    await page.getByLabel('Choose a Next168 export file').setInputFiles(v1Path)

    const preview = page.getByTestId('import-preview')
    await expect(page.getByTestId('import-version')).toContainText('migrated from version 1')
    await expect(page.getByTestId('count-categories')).toHaveText('2 categories')
    await expect(page.getByTestId('count-blocks')).toHaveText(`${LEGACY_BLOCK_COUNT} time blocks`)
    expect((await storedDocument(page)).categories).toHaveLength(4)
    await preview.getByRole('button', { name: 'Replace my data' }).click()
    await expect(page.getByTestId('data-notice')).toContainText('Imported and verified')

    const migrated = await storedDocument(page)
    expect(migrated.schemaVersion).toBe(2)
    expect(migrated.categories.map((category: { name: string }) => category.name)).toEqual(['Sleep', 'Work'])
    expect(migrated.blocks.find((block: { title: string }) => block.title === 'Deep work').days.sort()).toEqual([1, 2, 3])
  })

  test('an invalid file is rejected without touching the stored data', async ({ page }, testInfo) => {
    await startWith(page, plannerDocument())
    await openTab(page, 'settings')
    const path = testInfo.outputPath('broken.json')
    writeFileSync(path, '{ not json')
    await page.getByLabel('Choose a Next168 export file').setInputFiles(path)
    await expect(page.getByTestId('data-notice')).toContainText('cannot be imported')
    await expect(page.getByTestId('import-preview')).toHaveCount(0)
    expect((await storedDocument(page)).workspaceId).toBe('ws-e2e')
  })

  test('categories can be edited and only deleted when nothing references them', async ({ page }) => {
    await startWith(page, plannerDocument())
    await openTab(page, 'settings')

    await page.getByRole('button', { name: 'Edit Study' }).click()
    const dialog = page.getByRole('dialog', { name: 'Edit category' })
    await dialog.getByLabel('Name').fill('Deep study')
    await dialog.getByRole('radio', { name: 'At least' }).click()
    await dialog.getByLabel('Hours per week').fill('3')
    await dialog.getByRole('button', { name: 'Save' }).click()
    await expect(dialog).toBeHidden()
    const edited = (await storedDocument(page)).categories.find((category: { id: string }) => category.id === 'c-study')
    expect(edited).toMatchObject({ name: 'Deep study', goal: { type: 'min', hoursPerWeek: 3 } })

    await page.getByRole('button', { name: 'Edit Deep study' }).click()
    await expect(page.getByRole('dialog')).toContainText('This category has 1 block. To delete it, move everything to another category.')
    // No destination is chosen for the person: deleting waits for one.
    await expect(page.getByLabel('Move them to')).toHaveValue('')
    await expect(page.getByRole('button', { name: 'Move and delete' })).toBeDisabled()
    await page.getByLabel('Move them to').selectOption('c-work')
    await page.getByRole('button', { name: 'Move and delete' }).click()
    const categoryIds = async () => (await storedDocument(page)).categories.map((category: { id: string }) => category.id)
    await expect.poll(categoryIds).not.toContain('c-study')
    const reassigned = (await storedDocument(page)).blocks.find((block: { id: string }) => block.id === 'b-study')
    expect(reassigned.categoryId).toBe('c-work')

    await page.getByRole('button', { name: 'Undo' }).click()
    await expect.poll(async () => (await storedDocument(page)).blocks.find((block: { id: string }) => block.id === 'b-study').categoryId).toBe('c-study')

    await page.getByRole('button', { name: 'Edit Spare' }).click()
    await page.getByRole('button', { name: 'Delete category' }).click()
    await expect.poll(categoryIds).not.toContain('c-spare')
  })

  test('plan and measure views have no serious or critical accessibility violations', async ({ page }) => {
    await startWith(page, plannerDocument({
      tasks: [{ id: 't-1', title: 'Write report', categoryId: 'c-study', durationMin: 120, priority: 2, createdAt: '2026-10-20T10:00:00.000Z' }],
      checkIns: [{ date: '2026-10-25', bedtime: 1380, wake: 420, workEnd: 1320, exercise: 'yes', stress: 2 }],
    }))
    for (const route of ['tasks', 'insights', 'checkin', 'settings']) {
      await page.goto(`./#/${route}`)
      await expect(page.locator('main h1')).toBeVisible()
      await expect(page.locator('.view-enter-active, .view-leave-active')).toHaveCount(0)
      await page.waitForFunction(() => document.getAnimations().length === 0)
      const { violations } = await new AxeBuilder({ page: page as unknown as ConstructorParameters<typeof AxeBuilder>[0]['page'] }).include('main').analyze()
      const blocking = violations.filter((violation) => violation.impact === 'serious' || violation.impact === 'critical')
      expect(blocking.map((violation) => `${route}: ${violation.id} ${violation.nodes.map((node) => node.target).join(' | ')}`)).toEqual([])
    }
  })
})
