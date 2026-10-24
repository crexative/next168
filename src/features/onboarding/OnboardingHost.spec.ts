// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { fixedNow, testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import OnboardingHost from './OnboardingHost.vue'

const firstRun = () => ({ settings: { ...testDocument().settings, onboardingDone: false } })
let mounted: Mounted | undefined
beforeEach(() => { sessionStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { mounted?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

const root = () => document.body.querySelector<HTMLElement>('[data-testid=onboarding]')!
const button = (label: string) => [...root().querySelectorAll<HTMLButtonElement>('button, a')].find((candidate) => candidate.textContent?.trim() === label)!
async function click(label: string) { button(label).click(); await nextTick(); await nextTick() }
const box = (name: string) => root().querySelector<HTMLInputElement>(`input[aria-label="Use ${name}"]`)!
const row = (id: string) => root().querySelector<HTMLElement>(`[data-template=${id}]`)!
const counter = () => root().querySelector('[data-testid=week-counter]')!.textContent!.replace(/\s+/g, ' ').trim()
const lines = (id: string) => [...row(id).querySelectorAll('.routine-line')].map((line) => line.textContent!.replace(/\s+/g, ' ').trim())
const dialogs = () => [...document.body.querySelectorAll<HTMLElement>('[role=dialog]')]
const editor = () => dialogs()[dialogs().length - 1]!

async function openLine(id: string, index = 0) {
  row(id).querySelectorAll<HTMLButtonElement>('.routine-line')[index]!.click()
  await nextTick(); await nextTick()
}
async function editField(label: string, value: string) {
  const field = [...editor().querySelectorAll('label')].find((item) => item.textContent?.trim().startsWith(label))!.querySelector('input, select') as HTMLInputElement
  field.value = value
  field.dispatchEvent(new Event(field.tagName === 'SELECT' ? 'change' : 'input'))
  await nextTick()
}
const editorErrors = () => [...editor().querySelectorAll('[data-testid=editor-error]')].map((item) => item.textContent?.trim())
const editorSave = () => editor().querySelector<HTMLButtonElement>('button[type=submit]')!
async function saveEditor() { editorSave().click(); await nextTick(); await nextTick() }

describe('onboarding wizard', () => {
  it('opens as "Your typical week" with the trust line, Sleep and Work ticked and one whole-hour counter', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await nextTick()
    expect(document.body.textContent).toContain('Your typical week')
    expect(root().textContent).toContain('No account. Everything stays on this device.')
    expect(box('Sleep').checked).toBe(true)
    expect(box('Work').checked).toBe(true)
    expect(box('Exercise').checked).toBe(false)
    expect(counter()).toBe('96 h assigned · 72 h unassigned')
    box('Exercise').click()
    await nextTick()
    expect(counter()).toBe('99 h assigned · 69 h unassigned')
    // The retired wording is gone from the screen.
    expect(root().textContent).not.toMatch(/planned|\bfree\b/i)
  })

  it('shows each routine as days and one clock range, the commute there and back (ON2)', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    expect(lines('work')).toEqual([expect.stringMatching(/^Mon–Fri · 9:00\sAM–5:00\sPM$/)])
    box('Exercise').click(); box('Commute').click()
    await nextTick()
    expect(lines('exercise')).toEqual([expect.stringMatching(/^Mon, Wed, Fri · 6:00–7:00\sPM$/)])
    expect(lines('commute')).toEqual([expect.stringMatching(/^Mon–Fri · 7:30–8:00\sAM$/), expect.stringMatching(/^Mon–Fri · 5:00–5:30\sPM$/)])
  })

  it('has no colour picker, no pencil and no goal editor in setup', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    expect(root().querySelector('input[type=radio], .swatches, input.name, .goal-chip, input[type=number]')).toBeNull()
    expect(row('work').querySelector('[aria-label^="Edit Work"]')?.textContent).toMatch(/Mon–Fri/)
  })

  it('opens the Semana editor on a routine; saving changes the line, the counter and what is built (ON2)', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await openLine('work')
    expect(dialogs()).toHaveLength(2)
    expect(editor().textContent).toContain('Edit block')
    expect((editor().querySelector('input[type=time]') as HTMLInputElement).value).toBe('09:00')
    await editField('Starts', '08:00')
    await editField('Ends', '14:00')
    await saveEditor()
    expect(lines('work')).toEqual([expect.stringMatching(/^Mon–Fri · 8:00\sAM–2:00\sPM$/)])
    expect(counter()).toBe('86 h assigned · 82 h unassigned')
    await click('Next')
    await click('Finish')
    await mounted.store.settled()
    expect(mounted.store.document!.blocks.find((block) => block.title === 'Work')).toMatchObject({ start: 480, end: 840, days: [1, 2, 3, 4, 5] })
  })

  it('renames the routine from the editor, and the category and block carry the name', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await openLine('work')
    await editField('Title', 'Day job')
    await saveEditor()
    expect(box('Day job')).not.toBeNull()
    await click('Next'); await click('Finish')
    await mounted.store.settled()
    expect(mounted.store.document!.categories.map((category) => category.name)).toContain('Day job')
    expect(mounted.store.document!.blocks.map((block) => block.title)).toContain('Day job')
  })

  it('refuses a routine that overlaps another one of the wizard, exactly as Semana does', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    box('Exercise').click()
    await nextTick()
    await openLine('exercise')
    await editField('Starts', '09:30')
    await editField('Ends', '10:30')
    expect(editorErrors()).toEqual(['Overlaps “Work”. Change the time or the days.'])
    expect(editorSave().disabled).toBe(true)
    await editField('Starts', '17:00')
    await editField('Ends', '18:00')
    expect(editorErrors()).toEqual([])
    expect(editorSave().disabled).toBe(false)
  })

  it('deleting a routine in the editor takes the row out of the week and offers it again as it was', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await openLine('work')
    const remove = [...editor().querySelectorAll('button')].find((candidate) => candidate.textContent?.trim() === 'Delete block')!
    remove.click()
    await nextTick(); await nextTick()
    expect(box('Work').checked).toBe(false)
    expect(counter()).toBe('56 h assigned · 112 h unassigned')
    box('Work').click()
    await nextTick()
    expect(lines('work')).toEqual([expect.stringMatching(/^Mon–Fri · 9:00\sAM–5:00\sPM$/)])
  })

  it('keeps the page marked as having an open sheet while the editor closes under the wizard', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await openLine('work')
    expect(document.documentElement.dataset.sheetOpen).toBeDefined()
    await saveEditor()
    await nextTick()
    expect(root()).not.toBeNull()
    expect(document.documentElement.dataset.sheetOpen).toBeDefined()
  })

  it('shows one primary "Next" first, then "Back" and "Finish", and no "Not now" button (ON6)', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    const labels = () => [...root().querySelectorAll('.actions button')].map((candidate) => candidate.textContent?.trim())
    expect(labels()).toEqual(['Next'])
    await click('Next')
    expect(labels()).toEqual(['Back', 'Finish'])
    await click('Back')
    expect(labels()).toEqual(['Next'])
    expect(root().querySelector('[data-testid=not-now]')).toBeNull()
  })

  it('keeps "Next" disabled, with the reason, until one routine is ticked', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    box('Sleep').click(); box('Work').click()
    await nextTick()
    expect(button('Next').disabled).toBe(true)
    expect(root().querySelector('[data-testid=need-routine]')!.textContent).toBe('Pick at least one routine to continue.')
    box('Work').click()
    await nextTick()
    expect(button('Next').disabled).toBe(false)
    expect(root().querySelector('[data-testid=need-routine]')).toBeNull()
  })

  it('closing with the ✕ leaves an empty planner and marks onboarding done', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    document.body.querySelector<HTMLButtonElement>('[role=dialog] button[aria-label=Close]')!.click()
    await nextTick()
    await mounted.store.settled()
    expect(mounted.store.document!.settings.onboardingDone).toBe(true)
    expect(mounted.store.document!.categories).toEqual([])
  })

  it('asks for the first task with one field and no category choice (ON5)', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await click('Next')
    expect(document.body.textContent).toContain('Write something you want to do this week. Next168 will find it a free slot.')
    expect(root().querySelectorAll('input, select, textarea')).toHaveLength(1)
    expect(root().querySelector('select')).toBeNull()
    const title = root().querySelector<HTMLInputElement>('input[type=text]')!
    title.value = 'Book a check-up'; title.dispatchEvent(new Event('input'))
    await click('Finish')
    await mounted.store.settled()
    const task = mounted.store.document!.tasks[0]!
    expect(task).toMatchObject({ title: 'Book a check-up', durationMin: 60 })
    expect(mounted.store.document!.categories.find((category) => category.id === task.categoryId)!.name).toBe('Work')
  })

  it('says so, instead of dropping the task, when only Sleep is ticked', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    box('Work').click()
    await nextTick()
    await click('Next')
    expect(root().querySelector('input[type=text]')).toBeNull()
    expect(root().textContent).toContain('To add a task, also pick a routine other than Sleep.')
  })

  it('confirms the finished week in plain words with "See my week" and "Get started" (ON7)', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await click('Next')
    const title = root().querySelector<HTMLInputElement>('input[type=text]')!
    title.value = 'Book a check-up'; title.dispatchEvent(new Event('input'))
    await click('Finish')
    await mounted.store.settled()
    await nextTick()
    expect(root().dataset.state).toBe('done')
    expect(document.body.textContent).toContain('All set')
    expect(root().querySelector('[data-testid=onboarding-summary]')!.textContent).toBe('Your week is saved on this device only.')
    expect(root().querySelector('[data-testid=onboarding-task]')!.textContent).toContain('Book a check-up')
    expect(root().querySelector<HTMLAnchorElement>('[data-testid=see-week]')!.getAttribute('href')).toBe('#/week')
    expect(root().textContent).not.toMatch(/categor|block/i)
    await click('Get started')
    await vi.waitFor(() => expect(document.body.querySelector('[data-testid=onboarding]')).toBeNull())
  })

  it('does not run the persistence request when the wizard finishes (it waits for the first check-in)', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true })
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await click('Next'); await click('Finish')
    await mounted.store.settled()
    expect(persist).not.toHaveBeenCalled()
  })
})

describe('onboarding draft across a reload (ON8)', () => {
  async function startAndEdit() {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    box('Exercise').click()
    await nextTick()
    await openLine('work')
    await editField('Ends', '15:00')
    await saveEditor()
    await click('Next')
    const title = root().querySelector<HTMLInputElement>('input[type=text]')!
    title.value = 'Call the bank'; title.dispatchEvent(new Event('input'))
    await nextTick()
  }

  it('brings back the picks, the edited times, the step and the task title', async () => {
    await startAndEdit()
    mounted!.unmount()
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    expect(root().dataset.step).toBe('1')
    expect(root().querySelector<HTMLInputElement>('input[type=text]')!.value).toBe('Call the bank')
    await click('Back')
    expect(box('Exercise').checked).toBe(true)
    expect(lines('work')).toEqual([expect.stringMatching(/^Mon–Fri · 9:00\sAM–3:00\sPM$/)])
  })

  it('starts over when the workspace changed since the draft was saved', async () => {
    await startAndEdit()
    mounted!.unmount()
    mounted = await mountWithPlanner(OnboardingHost, { ...firstRun(), workspaceId: 'a-replaced-workspace' })
    expect(root().dataset.step).toBe('0')
    expect(box('Exercise').checked).toBe(false)
    expect(lines('work')).toEqual([expect.stringMatching(/^Mon–Fri · 9:00\sAM–5:00\sPM$/)])
  })

  it.each(['finish', 'close'] as const)('is forgotten once the person %ss', async (how) => {
    await startAndEdit()
    expect(sessionStorage.length).toBe(1)
    if (how === 'finish') await click('Finish')
    else document.body.querySelector<HTMLButtonElement>('[role=dialog] button[aria-label=Close]')!.click()
    await mounted!.store.settled()
    await nextTick()
    expect(sessionStorage.length).toBe(0)
  })

  it('does not keep a draft of an untouched wizard', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    box('Exercise').click(); await nextTick(); box('Exercise').click(); await nextTick()
    expect(sessionStorage.length).toBe(0)
  })
})
