// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import type { ChangeProposal, ExternalOccurrence, ProposalInput } from '@/core/model'
import { mountWithPlanner, WORK, type Mounted } from '@/features/settings/testSupport'
import { lastDecision } from '@/features/proposals/reviewState'
import AnyAiPanel from './AnyAiPanel.vue'
import { SYNTHETIC_CATEGORIES } from './syntheticWeek'

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
const CALENDAR = { id: 's', name: 'Work calendar', kind: 'file' as const, colorKey: 'teal' as const }
const stubClipboard = (writeText: (text: string) => Promise<void>) => vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } })

it('copies the prompt for the current plan and says so', async () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
  stubClipboard(writeText)
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await click('any-ai-copy')
  await vi.waitFor(() => expect($('any-ai-copied')).not.toBeNull())
  expect(writeText).toHaveBeenCalledTimes(1)
  const text = writeText.mock.calls[0]![0] as string
  expect(text).toContain('workspaceId="workspace-1" revision=1')
  expect(text).toContain('"Gym" [category="c-work"]: Tue 18:00-19:00 [id="b-gym"')
  expect($('any-ai-manual')).toBeNull()
})

it('shows the text to copy by hand when there is no Clipboard API', async () => {
  vi.stubGlobal('navigator', { ...navigator, clipboard: undefined })
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await click('any-ai-copy')
  await vi.waitFor(() => expect($('any-ai-manual')).not.toBeNull())
  expect($<HTMLTextAreaElement>('any-ai-manual')!.value).toContain('workspaceId="workspace-1" revision=1')
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
  expect(mounted.store.document!.blocks[0]!.days).toEqual([2])
  expect(mounted.store.document!.revision).toBe(1)
  // The reply stays until its proposal is approved: a person who cancels the review can review it again.
  expect($<HTMLTextAreaElement>('any-ai-paste')!.value).toBe(gymToThursday())
  lastDecision.value = { kind: 'rejected', id: 'p-1', tick: 1 }
  await nextTick()
  expect($<HTMLTextAreaElement>('any-ai-paste')!.value).toBe(gymToThursday())
  lastDecision.value = { kind: 'applied', id: 'another-proposal', tick: 2 }
  await nextTick()
  expect($<HTMLTextAreaElement>('any-ai-paste')!.value).toBe(gymToThursday())
  lastDecision.value = { kind: 'applied', id: 'p-1', tick: 3 }
  await nextTick()
  expect($<HTMLTextAreaElement>('any-ai-paste')!.value).toBe('')
})

it('says what to do for a reply without changes, keeps the text, and opens nothing', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await type('Sure, I would move the gym to Thursday.')
  await click('any-ai-review')
  await vi.waitFor(() => expect($('any-ai-error')).not.toBeNull())
  expect($('any-ai-error')!.textContent).toContain('Your AI answered without changes for Next168: maybe it only talked, or it needs something from you first. Read its message. To change your plan, ask it: “give me the changes in the next168 block”.')
  expect($('any-ai-error')!.textContent).toContain('Its reply begins:')
  expect($('any-ai-reply-start')!.textContent).toBe('Sure, I would move the gym to Thursday.')
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
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
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
  expect(writeText.mock.calls[1]![0]).toContain('"New" [id="c-new"]')
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
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
  stubClipboard(writeText)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T10:00:00Z') })
  try {
    mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM], calendarSources: [CALENDAR] })
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

it('cannot copy until the imported calendars of the current plan are read, and says it is loading them', async () => {
  let finish: (value: ExternalOccurrence[]) => void = () => undefined
  expand.mockReset()
  expand.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  const writeText = vi.fn<(text: string) => Promise<void>>(async () => undefined)
  stubClipboard(writeText)
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-21T10:00:00Z') })
  try {
    mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM], calendarSources: [CALENDAR] })
    await nextTick()
    expect($<HTMLButtonElement>('any-ai-copy')!.disabled).toBe(true)
    expect($('any-ai-calendars-loading')!.textContent).toBe('Loading your calendars…')
    $('any-ai-copy')!.click(); await nextTick()
    expect(writeText).not.toHaveBeenCalled()
    finish([{ sourceId: 's', uid: 'u', title: 'Standup', start: '2026-10-22T09:00:00Z', end: '2026-10-22T09:15:00Z', allDay: false, busy: true }])
    await vi.waitFor(() => expect($<HTMLButtonElement>('any-ai-copy')!.disabled).toBe(false))
    expect($('any-ai-calendars-loading')).toBeNull()
    // The plan changes: its calendars are read again before the next copy.
    await mounted.store.commit((draft) => { draft.categories.push({ id: 'c-new', name: 'New', colorKey: 'green', goal: { type: 'none', hoursPerWeek: 0 } }) })
    await nextTick()
    expect($<HTMLButtonElement>('any-ai-copy')!.disabled).toBe(true)
    finish([{ sourceId: 's', uid: 'u', title: 'Standup', start: '2026-10-22T09:00:00Z', end: '2026-10-22T09:15:00Z', allDay: false, busy: true }])
    await vi.waitFor(() => expect($<HTMLButtonElement>('any-ai-copy')!.disabled).toBe(false))
    await click('any-ai-copy')
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0]![0]).toContain('"Standup"')
    expect(writeText.mock.calls[0]![0]).toContain('revision=2')
    // A press that lands after the plan changed but before the button re-renders still waits for the new read.
    mounted.store.document = { ...mounted.store.document!, revision: 3 }
    $('any-ai-copy')!.click()
    await nextTick()
    expect(writeText).toHaveBeenCalledTimes(1)
    expect($<HTMLButtonElement>('any-ai-copy')!.disabled).toBe(true)
  } finally { vi.useRealTimers() }
})

it('with no categories, says in one line that the AI can create them', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [], blocks: [] })
  expect($('any-ai-empty-hint')!.textContent).toBe('You have no categories yet: your AI can create them in the same changes it proposes.')
  mounted.unmount()
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  expect($('any-ai-empty-hint')).toBeNull()
})

it('names the limit when a reply has too many changes', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  const ops = Array.from({ length: 201 }, () => ({ op: 'update_block', id: 'b-gym', patch: { days: [4] } }))
  await type(gymToThursday({ ops }))
  await click('any-ai-review')
  await vi.waitFor(() => expect($('any-ai-error')).not.toBeNull())
  expect($('any-ai-error')!.textContent).toContain('Your AI sent 201 changes and a proposal holds at most 200.')
  expect(create).not.toHaveBeenCalled()
})

it('says plainly when the AI wants to create a category the plan already has', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [WORK], blocks: [GYM] })
  await type(gymToThursday({ ops: [{ op: 'add_category', ref: 'new-work', category: { name: ' work ' } }] }))
  await click('any-ai-review')
  await vi.waitFor(() => expect($('any-ai-error')).not.toBeNull())
  expect($('any-ai-error')!.textContent).toContain('Your AI wants to create the category “Work”, but you already have it.')
  expect($('any-ai-copy-again')).not.toBeNull()
  expect(create).not.toHaveBeenCalled()
})

it('accepts a reply that creates every category of an empty plan and uses them in the same proposal', async () => {
  mounted = await mountWithPlanner(AnyAiPanel, { categories: [], blocks: [] })
  const ops = [
    ...SYNTHETIC_CATEGORIES.slice(0, 2).map(({ ref, name, goal }) => ({ op: 'add_category', ref, category: { name, goal } })),
    { op: 'add_block', block: { categoryId: 'new-sleep', title: 'Dormir', days: [0, 1, 2, 3, 4], start: 1350, end: 390 } },
    { op: 'add_task', task: { title: 'Revisar contrato', categoryId: 'new-work', durationMin: 15, priority: 2 } },
  ]
  await type(gymToThursday({ ops }))
  await click('any-ai-review')
  await vi.waitFor(() => expect(opened).toHaveBeenCalledTimes(1))
  expect(create.mock.calls[0]![0].ops).toHaveLength(4)
})
