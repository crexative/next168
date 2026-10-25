// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { createApp, nextTick, type App } from 'vue'
import type { ProposalRepository } from '@/core/model'
import { i18n } from '@/i18n'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import AnyAiPanel from '@/features/assistant/anyAi/AnyAiPanel.vue'
import { reviewing } from '@/features/proposals/reviewState'
import { createTestRepositories, fixedNow, newTestId, testDocument } from './testSupport'

let proposals: ProposalRepository
let app: App | undefined
vi.mock('@/features/proposals/repository', () => ({ getProposalRepository: () => proposals }))

afterEach(() => { app?.unmount(); app = undefined; reviewing.value = null; vi.unstubAllGlobals() })

it('copies an unsaved plan, reloads, and opens the review of the reply from that copy', async () => {
  const first = createTestRepositories()
  proposals = first.proposals
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })
  async function load(repos: typeof first) {
    const pinia = createPinia()
    setActivePinia(pinia)
    configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => 'es', timeZone: () => 'UTC' })
    const planner = usePlannerStore()
    await planner.load()
    const host = document.createElement('div')
    document.body.append(host)
    app = createApp(AnyAiPanel).use(pinia).use(i18n)
    app.mount(host)
    await nextTick()
    return planner
  }
  const before = await load(first)
  const workspaceId = before.document!.workspaceId
  document.querySelector<HTMLButtonElement>('[data-testid=any-ai-copy]')!.click()
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
  expect(writeText.mock.calls[0]![0]).toContain(`workspaceId="${workspaceId}"`)
  app!.unmount()
  document.body.innerHTML = ''
  const after = await load(createTestRepositories({ store: first.store, runExclusive: first.runExclusive }))
  const box = document.querySelector<HTMLTextAreaElement>('[data-testid=any-ai-paste]')!
  box.value = `\`\`\`next168\n${JSON.stringify({ contractVersion: '1.0', workspaceId, baseRevision: 0, summary: 'Read', ops: [{ op: 'add_task', task: { title: 'Read', durationMin: 15, priority: 1 } }] })}\n\`\`\``
  box.dispatchEvent(new Event('input'))
  await nextTick()
  document.querySelector<HTMLButtonElement>('[data-testid=any-ai-review]')!.click()
  await vi.waitFor(() => expect(document.querySelector<HTMLButtonElement>('[data-testid=review-approve]')?.disabled).toBe(false))
  expect(reviewing.value?.workspaceId).toBe(workspaceId)
  expect(after.stored).toBe(false)
  expect((await first.store.read(['document'])).document).toBeUndefined()
})

it('shares one generated baseline across concurrent tabs and drops it on the first stored write', async () => {
  const first = createTestRepositories()
  const second = createTestRepositories({ store: first.store, runExclusive: first.runExclusive })
  const results = await Promise.all([first.planner.load(), second.planner.load()])
  expect(results[0]).toHaveProperty('document.workspaceId')
  expect(results[1]).toEqual(results[0])
  await first.planner.save(testDocument({ revision: 1 }), 0)
  expect((await first.store.read(['unsavedBaseline'])).unsavedBaseline).toBeUndefined()
})
