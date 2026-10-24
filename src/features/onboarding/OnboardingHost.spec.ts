// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { fixedNow, testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import OnboardingHost from './OnboardingHost.vue'

const firstRun = () => ({ settings: { ...testDocument().settings, onboardingDone: false } })
let mounted: Mounted | undefined
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(fixedNow()) })
afterEach(() => { mounted?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

const root = () => document.body.querySelector<HTMLElement>('[data-testid=onboarding]')!
const button = (label: string) => [...root().querySelectorAll<HTMLButtonElement>('button')].find((candidate) => candidate.textContent?.trim() === label)!
async function click(label: string) { button(label).click(); await nextTick(); await nextTick() }
const box = (name: string) => root().querySelector<HTMLInputElement>(`input[aria-label="Use ${name}"]`)!

describe('onboarding wizard', () => {
  it('opens with the 168-hour promise, Sleep and Work ticked and a live counter', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await nextTick()
    expect(document.body.querySelector('[role=dialog]')?.getAttribute('aria-label') ?? document.body.textContent).toContain('Your week has 168 hours. Decide where they go.')
    expect(root().textContent).toContain('No account. Everything stays on this device.')
    expect(box('Sleep').checked).toBe(true)
    expect(box('Work').checked).toBe(true)
    expect(box('Exercise').checked).toBe(false)
    const counter = () => root().querySelector('[data-testid=week-counter]')!.textContent!
    expect(counter()).toContain('96 of 168 h planned')
    expect(counter()).toContain('72 h free')
    box('Exercise').click()
    await nextTick()
    expect(counter()).toContain('99 of 168 h planned')
    expect(counter()).toContain('69 h free')
  })

  it('keeps "Next" disabled until one category is picked, and offers exactly one "Not now"', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    box('Sleep').click(); box('Work').click()
    await nextTick()
    expect(button('Next').disabled).toBe(true)
    expect([...root().querySelectorAll('button')].filter((candidate) => candidate.textContent?.trim() === 'Not now')).toHaveLength(1)
    box('Work').click()
    await nextTick()
    expect(button('Next').disabled).toBe(false)
  })

  it('shows a category that is not in the week as disabled, with its edit control switched off', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    const row = root().querySelector<HTMLElement>('[data-template=family]')!
    expect(row.classList.contains('is-off')).toBe(true)
    expect(row.querySelector<HTMLButtonElement>('.edit-button')!.disabled).toBe(true)
    expect(root().querySelector<HTMLButtonElement>('[data-template=work] .edit-button')!.disabled).toBe(false)
  })

  it('renames and recolours through Edit, and the saved category carries both', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    root().querySelector<HTMLButtonElement>('[data-template=work] .edit-button')!.click()
    await nextTick()
    const name = root().querySelector<HTMLInputElement>('input.name')!
    name.value = 'Day job'; name.dispatchEvent(new Event('input'))
    root().querySelector<HTMLInputElement>('input[type=radio][value=red]')!.click()
    await nextTick()
    await click('Next'); await click('Next'); await click('Finish')
    await mounted.store.settled()
    expect(mounted.store.document!.categories.map((category) => [category.name, category.colorKey])).toContainEqual(['Day job', 'red'])
  })

  it('does not offer, while editing, a colour another picked category uses', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    root().querySelector<HTMLButtonElement>('[data-template=work] .edit-button')!.click()
    await nextTick()
    // Sleep is ticked and purple, so Work cannot take purple; an unused colour stays available.
    expect(root().querySelector<HTMLInputElement>('input[type=radio][value=purple]')!.disabled).toBe(true)
    expect(root().querySelector<HTMLInputElement>('input[type=radio][value=red]')!.disabled).toBe(false)
    // Unticking Sleep closes the open editor; once reopened, purple is free again.
    box('Sleep').click()
    await nextTick()
    root().querySelector<HTMLButtonElement>('[data-template=work] .edit-button')!.click()
    await nextTick()
    expect(root().querySelector<HTMLInputElement>('input[type=radio][value=purple]')!.disabled).toBe(false)
  })

  it('does not offer the colour of a category the workspace keeps, even when it is unticked here', async () => {
    mounted = await mountWithPlanner(OnboardingHost, { ...firstRun(), categories: [{ id: 'c-reading', name: 'Reading', colorKey: 'teal', goal: { type: 'none', hoursPerWeek: 0 } }] })
    await nextTick()
    const reading = root().querySelector<HTMLInputElement>('input[aria-label="Use Reading"]')!
    reading.click()
    await nextTick()
    expect(reading.checked).toBe(false)
    const work = root().querySelector<HTMLInputElement>('input[aria-label="Use Work"]')!
    if (!work.checked) { work.click(); await nextTick() }
    root().querySelector<HTMLButtonElement>('[data-template=work] .edit-button')!.click()
    await nextTick()
    expect(root().querySelector<HTMLInputElement>('input[type=radio][value=teal]')!.disabled).toBe(true)
  })

  it('lets the person edit a goal chip on step 2 and saves it', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await click('Next')
    const chip = root().querySelector<HTMLButtonElement>('[data-template=work] .goal-chip')!
    expect(chip.textContent).toContain('Max 40 h')
    chip.click()
    await nextTick()
    const hours = root().querySelector<HTMLInputElement>('[data-template=work] input[type=number]')!
    hours.value = '32'; hours.dispatchEvent(new Event('input'))
    await nextTick()
    expect(root().querySelector('[data-template=work] .goal-chip')!.textContent).toContain('Max 32 h')
    hours.value = '0'; hours.dispatchEvent(new Event('input'))
    await nextTick()
    expect(button('Next').disabled).toBe(true)
    expect(root().textContent).toContain('Use between 0.5 and 168 hours.')
    hours.value = '32'; hours.dispatchEvent(new Event('input'))
    await nextTick()
    await click('Next'); await click('Finish')
    await mounted.store.settled()
    expect(mounted.store.document!.categories.find((category) => category.name === 'Work')!.goal).toEqual({ type: 'max', hoursPerWeek: 32 })
  })

  it('"Not now" leaves an empty planner and marks onboarding done', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await click('Not now')
    await mounted.store.settled()
    expect(mounted.store.document!.settings.onboardingDone).toBe(true)
    expect(mounted.store.document!.categories).toEqual([])
  })

  it('confirms the finished week and offers "See in Week"', async () => {
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await click('Next'); await click('Next')
    const title = root().querySelector<HTMLInputElement>('input[type=text]')!
    title.value = 'Book a check-up'; title.dispatchEvent(new Event('input'))
    await click('Finish')
    await mounted.store.settled()
    await nextTick()
    expect(root().dataset.state).toBe('done')
    expect(root().querySelector('[data-testid=onboarding-summary]')!.textContent).toContain('2 categories and 2 blocks')
    expect(root().querySelector('[data-testid=onboarding-task]')!.textContent).toContain('Book a check-up')
    expect(root().querySelector<HTMLAnchorElement>('[data-testid=see-week]')!.getAttribute('href')).toBe('#/week')
  })

  it('does not run the persistence request when the wizard finishes (it waits for the first check-in)', async () => {
    const persist = vi.fn().mockResolvedValue(true)
    Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true })
    mounted = await mountWithPlanner(OnboardingHost, firstRun())
    await click('Next'); await click('Next'); await click('Finish')
    await mounted.store.settled()
    expect(persist).not.toHaveBeenCalled()
  })
})
