// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, WORK, type Mounted } from '@/features/settings/testSupport'
import SetupWeekPrompt from './SetupWeekPrompt.vue'
import { setupRequest } from './reopen'

const done = { settings: { ...testDocument().settings, onboardingDone: true } }
let mounted: Mounted | undefined
afterEach(() => { mounted?.unmount(); document.body.innerHTML = '' })

it('offers "Set up my week · 1 min" on an empty week and opens the guided setup without writing', async () => {
  mounted = await mountWithPlanner(SetupWeekPrompt, { ...done, categories: [WORK] })
  const prompt = mounted.host.querySelector<HTMLButtonElement>('[data-testid=setup-week]')!
  expect(prompt.textContent).toBe('Set up my week · 1 min')
  const requests = setupRequest.value
  prompt.click()
  await mounted.store.settled()
  await nextTick()
  expect(setupRequest.value).toBe(requests + 1)
  expect(mounted.store.document!.revision).toBe(1)
  expect(mounted.store.document!.settings.onboardingDone).toBe(true)
  // Still offered: the week is still empty until the setup is saved.
  expect(mounted.host.querySelector('[data-testid=setup-week]')).not.toBeNull()
})

it('is offered on an empty week whether or not the first setup was finished', async () => {
  mounted = await mountWithPlanner(SetupWeekPrompt, { settings: { ...testDocument().settings, onboardingDone: false } })
  expect(mounted.host.querySelector('[data-testid=setup-week]')).not.toBeNull()
})

it('stays out of the way once the week has blocks', async () => {
  mounted = await mountWithPlanner(SetupWeekPrompt, { ...done, categories: [WORK], blocks: [{ id: 'b', categoryId: 'c-work', title: 'Work', days: [1], start: 540, end: 600 }] })
  expect(mounted.host.querySelector('[data-testid=setup-week]')).toBeNull()
})
