// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { nextTick } from 'vue'
import { testDocument } from '@/repositories/testSupport'
import { mountWithPlanner, WORK, type Mounted } from '@/features/settings/testSupport'
import SetupWeekPrompt from './SetupWeekPrompt.vue'

const done = { settings: { ...testDocument().settings, onboardingDone: true } }
let mounted: Mounted | undefined
afterEach(() => { mounted?.unmount(); document.body.innerHTML = '' })

it('offers "Set up my week · 1 min" on an empty week and reopens the wizard', async () => {
  mounted = await mountWithPlanner(SetupWeekPrompt, { ...done, categories: [WORK] })
  const prompt = mounted.host.querySelector<HTMLButtonElement>('[data-testid=setup-week]')!
  expect(prompt.textContent).toBe('Set up my week · 1 min')
  prompt.click()
  await mounted.store.settled()
  await nextTick()
  expect(mounted.store.document!.settings.onboardingDone).toBe(false)
  expect(mounted.host.querySelector('[data-testid=setup-week]')).toBeNull()
})

it('stays out of the way once the week has blocks', async () => {
  mounted = await mountWithPlanner(SetupWeekPrompt, { ...done, categories: [WORK], blocks: [{ id: 'b', categoryId: 'c-work', title: 'Work', days: [1], start: 540, end: 600 }] })
  expect(mounted.host.querySelector('[data-testid=setup-week]')).toBeNull()
})
