// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import type { ChangeProposal, ExternalOccurrence, ProposalInput } from '@/core/model'
import { mountWithPlanner, WORK, type Mounted } from '@/features/settings/testSupport'
import AnyAiPanel from './AnyAiPanel.vue'

const opened = vi.fn()
let release: () => void = () => undefined
let gate: Promise<void> | null = null
const create = vi.fn(async (input: ProposalInput, source: ChangeProposal['source']): Promise<ChangeProposal> => {
  if (gate) await gate
  return { id: `p-${create.mock.calls.length}`, source, summary: input.summary, status: 'pending' } as ChangeProposal
})
const expand = vi.fn(async (): Promise<ExternalOccurrence[]> => [])
vi.mock('@/features/calendars/occurrenceSource', () => ({ expandCalendarSources: () => expand() }))
vi.mock('@/features/proposals', () => ({ openProposalReview: (proposal: ChangeProposal) => opened(proposal) }))
vi.mock('@/features/proposals/repository', () => ({ getProposalRepository: () => ({ create: (...args: Parameters<typeof create>) => create(...args), list: async () => [] }) }))

let mounted: Mounted | undefined
beforeEach(() => { opened.mockClear(); create.mockClear(); expand.mockReset(); expand.mockResolvedValue([]); gate = null })
afterEach(() => { mounted?.unmount(); mounted = undefined; vi.unstubAllGlobals(); document.body.innerHTML = '' })

const GYM = { id: 'b-gym', categoryId: 'c-work', title: 'Gym', days: [2], start: 1080, end: 1140 }
const $ = <T extends HTMLElement>(id: string) => mounted!.host.querySelector<T>(`[data-testid=${id}]`)
const click = async (id: string) => { $(id)!.click(); await vi.waitFor(() => undefined); await nextTick() }
const type = async (text: string) => { const box = $<HTMLTextAreaElement>('any-ai-paste')!; box.value = text; box.dispatchEvent(new Event('input')); await nextTick() }
const gymToThursday = (overrides: Record<string, unknown> = {}) => `Sure! I moved it.\n\n\`\`\`next168\n${JSON.stringify({
  contractVersion: '1.0', workspaceId: 'workspace-1', baseRevision: 1, summary: 'Move the gym to Thursday',
  ops: [{ op: 'update_block', id: 'b-gym', patch: { days: [4] } }], ...overrides,
})}\n\`\`\`\nAnything else?`
const stubClipboard = (writeText: (text: string) => Promise<void>) => vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

it('copies the prompt for the current plan and says so', async () => {
  const writeText = vi.fn(async () => undefined)
  stubClipboard(writeText)
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await click('any-ai-copy')
  await vi.waitFor(() => expect($('any-ai-copied')).not.toBeNull())
  expect(writeText).toHaveBeenCalledTimes(1)
  const text = writeText.mock.calls[0]![0] as string
  expect(text).toContain('workspaceId=workspace-1 revision=1')
  expect(text).toContain('"Gym" Tue 18:00-19:00 [id=b-gym')
  expect($('any-ai-manual')).toBeNull()
})

it('shows the text to copy by hand when there is no Clipboard API', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await click('any-ai-copy')
  await vi.waitFor(() => expect($('any-ai-manual')).not.toBeNull())
  expect($<HTMLTextAreaElement>('any-ai-manual')!.value).toContain('workspaceId=workspace-1 revision=1')
  expect($<HTMLTextAreaElement>('any-ai-manual')!.readOnly).toBe(true)
  expect($('any-ai-copied')).toBeNull()
})

it('shows the same fallback when the browser refuses the copy', async () => {
  stubClipboard(async () => { throw new DOMException('denied', 'NotAllowedError') })
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await click('any-ai-copy')
  await vi.waitFor(() => expect($('any-ai-manual')).not.toBeNull())
  expect($('any-ai-copied')).toBeNull()
})

it('turns a pasted reply into a pending proposal and opens the review; it applies nothing', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  expect($<HTMLButtonElement>('any-ai-review')!.disabled).toBe(true)
  await type(gymToThursday())
  expect($<HTMLButtonElement>('any-ai-review')!.disabled).toBe(false)
  await click('any-ai-review')
  await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ summary: 'Move the gym to Thursday' }), 'import')
  expect(opened.mock.calls[0]![0]).toMatchObject({ status: 'pending' })
  expect($<HTMLTextAreaElement>('any-ai-paste')!.value).toBe('')
  expect(mounted.store.document!.blocks[0]!.days).toEqual([2])
  expect(mounted.store.document!.revision).toBe(1)
})

it('says what to do for a reply without changes, keeps the text, and opens nothing', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await type('Sure, I would move the gym to Thursday.')
  await click('any-ai-review')
  await vi.waitFor(() => expect($('any-ai-error')).not.toBeNull())
  expect($('any-ai-error')!.textContent).toContain('I didn’t find any changes. Ask your AI: “give me the changes in the next168 block”.')
  expect($('any-ai-error')!.getAttribute('role')).toBe('alert')
  expect($('any-ai-copy-again')).toBeNull()
  expect($<HTMLTextAreaElement>('any-ai-paste')!.value).toBe('Sure, I would move the gym to Thursday.')
  expect($('any-ai-paste')!.getAttribute('aria-invalid')).toBe('true')
  expect(create).not.toHaveBeenCalled()
  expect(opened).not.toHaveBeenCalled()
  await type('Sure, I would move the gym to Thursday!')
  expect($('any-ai-error')).toBeNull()
})

it('refuses a reply for an older revision with a "Copy again" that copies the current plan', async () => {
  const writeText = vi.fn(async () => undefined)
  stubClipboard(writeText)
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await click('any-ai-copy')
  // The plan changes after the copy.
  await mounted.store.commit((draft) => { draft.categories.push({ id: 'c-new', name: 'New', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } }) })
  await type(gymToThursday())
  await click('any-ai-review')
  await vi.waitFor(() => expect($('any-ai-error')).not.toBeNull())
  expect($('any-ai-error')!.textContent).toContain('Your plan changed after you copied it for your AI.')
  expect(create).not.toHaveBeenCalled()
  await click('any-ai-copy-again')
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(2))
  expect(writeText.mock.calls[1]![0]).toContain('revision=2')
  expect(writeText.mock.calls[1]![0]).toContain('"New" [id=c-new]')
  expect($('any-ai-error')).toBeNull()
})

it('refuses a reply made for another workspace', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await type(gymToThursday({ workspaceId: 'someone-elses-plan' }))
  await click('any-ai-review')
  await vi.waitFor(() => expect($('any-ai-error')).not.toBeNull())
  expect($('any-ai-error')!.textContent).toContain('different plan')
  expect($('any-ai-copy-again')).not.toBeNull()
  expect(create).not.toHaveBeenCalled()
})

it('ignores a second press while the first review is still being saved', async () => {
  gate = new Promise<void>((resolve) => { release = resolve })
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await type(gymToThursday())
  $('any-ai-review')!.click()
  $('any-ai-review')!.click()
  await vi.waitFor(() => expect(create).toHaveBeenCalledTimes(1))
  release()
  await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
  await nextTick()
  expect(create).toHaveBeenCalledTimes(1)
})

it('the collapsible entry starts closed, opens on demand and exposes its state', async () => {
  mounted = await mountWithPlanner(defineComponent({ render: () => h(AnyAiPanel, { collapsible: true }) }), { categories: [WORK], blocks: [GYM] })
  const toggle = $<HTMLButtonElement>('any-ai-toggle')!
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect($('any-ai-copy')).toBeNull()
  expect(toggle.textContent).toContain('Use with your AI (ChatGPT, Claude, Gemini…)')
  toggle.click(); await nextTick()
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect($('any-ai-copy')).not.toBeNull()
  expect(mounted.host.querySelectorAll('ol li')).toHaveLength(3)
  toggle.click(); await nextTick()
  expect($('any-ai-copy')).toBeNull()
})

it('an open panel (Settings) has no toggle button', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  expect($('any-ai-toggle')!.tagName).toBe('DIV')
  expect($('any-ai-toggle')!.hasAttribute('aria-expanded')).toBe(false)
})

it('uses the newest read of the imported calendars when an older read finishes last', async () => {
  const occurrence = (title: string): ExternalOccurrence => ({ sourceId: 's', uid: title, title, start: '2026-10-24T09:00:00Z', end: '2026-10-24T10:00:00Z', allDay: false, busy: true })
  let finishOld: (value: ExternalOccurrence[]) => void = () => undefined
  expand.mockReset()
  expand.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve }))
  expand.mockResolvedValue([occurrence('Fresh meeting')])
  const writeText = vi.fn(async () => undefined)
  stubClipboard(writeText)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T10:00:00Z') })
  try {
    mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
    await mounted.store.commit((draft) => { draft.categories.push({ id: 'c-new', name: 'New', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } }) })
    await vi.waitFor(() => expect(expand).toHaveBeenCalledTimes(2))
    await nextTick(); await nextTick()
    finishOld([occurrence('Old meeting')])
    await nextTick(); await nextTick()
    await click('any-ai-copy')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalled())
    const text = writeText.mock.calls[0]![0] as string
    expect(text).toContain('"Fresh meeting"')
    expect(text).not.toContain('Old meeting')
  } finally { vi.useRealTimers() }
})
