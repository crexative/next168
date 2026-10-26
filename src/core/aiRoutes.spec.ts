// Tasks P1-7 (design rev 2.1 §11.1, rev 4 §2.3): a sentinel note in a task, a routine, an event and a check-in, plus a
// note the app itself copies into a proposal (a routine split by the on-device model keeps its notes), never reaches any
// AI-facing route of the browser: the on-device model's context (answer and change modes), the "Use with your AI"
// prompt, the pasted snapshot, and the AI view of a proposal. The MCP routes are covered in companion/test/projection.test.ts.
import { describe, expect, it, vi } from 'vitest'
import type { PlannerDocument } from './model'
import { aiProjection, proposalView } from './aiProjection'
import { assistantContext } from './assistantContext'
import { buildProposal } from './proposals'
import { buildAiPrompt } from '@/features/assistant/anyAi/buildPrompt'
import { parseIntent, proposalFromIntent } from '@/features/assistant/changeIntent'
import { contextFor, plannerWithBlocks, translatorFor } from '@/features/assistant/testSupport'
import { WebLlmProvider, type WebLlmDependencies, type WebLlmEngine } from '@/features/assistant/WebLlmProvider'
import { snapshotAndPrompt } from '@/features/settings/connect/transfer'

const SENTINEL = 'SYNTHETIC_PRIVATE_NOTE'

function plannerWithNotes(): PlannerDocument {
  const document = plannerWithBlocks()
  document.blocks = document.blocks.map((block) => ({ ...block, notes: `${SENTINEL} block` }))
  document.tasks.push({ id: 't-note', title: 'Write report', durationMin: 60, priority: 2, notes: `${SENTINEL} task`, createdAt: '2026-10-20T08:00:00.000Z' })
  document.events.push({ id: 'e-note', title: 'Dentist', start: '2026-10-26T14:00:00Z', end: '2026-10-26T15:00:00Z', allDay: false, notes: `${SENTINEL} event`, attendees: ['someone@example.invalid'] })
  document.checkIns.push({ date: '2026-10-23', stress: 3, note: `${SENTINEL} check-in` })
  return document
}

const leaks = (text: string) => text.includes(SENTINEL) || text.includes('someone@example.invalid')

async function onDeviceSystemPrompts(document: PlannerDocument): Promise<string[]> {
  const requests: { messages: { content: string }[] }[] = []
  const engine: WebLlmEngine = {
    chat: { completions: { create: vi.fn(async (request: unknown) => {
      requests.push(request as { messages: { content: string }[] })
      return { choices: [{ message: { content: '{"answer":"ok","intent":"none"}' } }] }
    }) } },
    interruptGenerate: vi.fn(), unload: vi.fn(async () => undefined),
  }
  const dependencies: WebLlmDependencies = {
    loadModule: async () => ({ CreateWebWorkerMLCEngine: vi.fn(async () => engine), hasModelInCache: vi.fn(async () => true), deleteModelAllInfoInCache: vi.fn(async () => undefined) }),
    createWorker: () => ({ terminate: vi.fn() }) as unknown as Worker,
    probe: async () => ({ webGpu: true, shaderF16: true, maxBufferSize: 2 ** 31, deviceMemoryGb: 8, storageQuotaBytes: 50e9, storageUsageBytes: 1e9 }),
  }
  const provider = new WebLlmProvider(dependencies)
  await provider.prepare(() => undefined, new AbortController().signal)
  const context = contextFor(document)
  await provider.ask('How many hours of work do I have?', context, new AbortController().signal).catch(() => undefined)
  await provider.ask('Move Reading to Thursday at 19:00', context, new AbortController().signal).catch(() => undefined)
  return requests.flatMap((request) => request.messages.map((message) => message.content))
}

describe('P1-7: no note leaves the app through a browser AI route', () => {
  const document = plannerWithNotes()

  it('the AI projection drops every note and says one exists', () => {
    const shared = aiProjection(document)
    expect(leaks(JSON.stringify(shared))).toBe(false)
    expect(shared.tasks.find((task) => task.id === 't-note')).toMatchObject({ hasNotes: true })
    expect(shared.blocks.every((block) => block.hasNotes)).toBe(true)
    expect(shared.events[0]).toMatchObject({ hasNotes: true })
    expect(shared.checkIns[0]).toMatchObject({ hasNotes: true })
  })

  it('the context every model reads (assistantContext)', () => {
    expect(leaks(assistantContext(document))).toBe(false)
  })

  it('the "Use with your AI" prompt', () => {
    const prompt = buildAiPrompt({ document, now: new Date('2026-10-24T12:00:00Z'), locale: 'en', translate: translatorFor('en') })
    expect(prompt).toContain('Write report')
    expect(leaks(prompt)).toBe(false)
  })

  it('the pasted snapshot of Connect', () => {
    expect(leaks(snapshotAndPrompt(document))).toBe(false)
  })

  it('the on-device model, answering and proposing', async () => {
    const prompts = await onDeviceSystemPrompts(document)
    expect(prompts.length).toBeGreaterThanOrEqual(2)
    for (const prompt of prompts) expect(leaks(prompt)).toBe(false)
  })

  it('the AI view of a proposal whose ops carry a note the app copied', async () => {
    const intent = parseIntent({ intent: 'move_block', title: 'Deep work', fromDay: 'monday', day: 'thursday', start: '10:00' })
    const outcome = proposalFromIntent(intent, {
      request: 'Move Deep work from Monday to Thursday at 10:00', document, locale: 'en', translate: translatorFor('en'),
    })
    if (outcome.kind !== 'proposal') throw new Error(`no proposal: ${JSON.stringify(outcome)}`)
    const proposal = await buildProposal(outcome.proposal, document, 'assistant', { now: () => new Date('2026-10-24T12:00:00Z') }, () => 'p-split')
    expect(JSON.stringify(proposal.ops)).toContain(SENTINEL)
    expect(leaks(JSON.stringify(proposalView(proposal, document)))).toBe(false)
  })
})
