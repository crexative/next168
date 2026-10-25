import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { setHourCycle } from '@/ui/format'
import type { DeviceCapabilities } from './capabilities'
import { AssistantError, type AskContext } from './provider'
import {
  WEBLLM_MODEL_ID, WebLlmProvider, classifyFailure, quoteFacts,
  type WebLlmDependencies, type WebLlmEngine, type WebLlmModule,
} from './WebLlmProvider'
import { applyProposal, buildProposal } from '@/core/proposals'
import { contextFor, plannerWithBlocks } from './testSupport'

const capable: DeviceCapabilities = { webGpu: true, shaderF16: true, maxBufferSize: 2 ** 31, deviceMemoryGb: 8, storageQuotaBytes: 50e9, storageUsageBytes: 1e9 }

function fakeEngine(reply: () => string | Promise<string> = () => '{"answer":"ok"}') {
  const engine = {
    create: vi.fn<(request: unknown) => Promise<{ choices: { message: { content: string | null } }[] }>>(async () => ({ choices: [{ message: { content: await reply() } }] })),
    interruptGenerate: vi.fn(),
    unload: vi.fn(async () => undefined),
  }
  const value: WebLlmEngine = { chat: { completions: { create: engine.create } }, interruptGenerate: engine.interruptGenerate, unload: engine.unload }
  return { engine, value }
}

function setup(options: { capabilities?: Partial<DeviceCapabilities>; cached?: boolean; create?: WebLlmModule['CreateWebWorkerMLCEngine']; engine?: ReturnType<typeof fakeEngine> } = {}) {
  const engine = options.engine ?? fakeEngine()
  const worker = { terminate: vi.fn() }
  const module: WebLlmModule = {
    CreateWebWorkerMLCEngine: vi.fn(options.create ?? (async (_worker, _id, config) => {
      config?.initProgressCallback?.({ progress: 0.5, text: 'half' })
      return engine.value
    })),
    hasModelInCache: vi.fn(async () => options.cached ?? false),
    deleteModelAllInfoInCache: vi.fn(async () => undefined),
  }
  const dependencies: WebLlmDependencies = {
    loadModule: async () => module,
    createWorker: () => worker as unknown as Worker,
    probe: async () => ({ ...capable, ...options.capabilities }),
  }
  return { provider: new WebLlmProvider(dependencies), module, worker, engine }
}

const context = (): AskContext => contextFor(plannerWithBlocks())
const signal = () => new AbortController().signal

// The summaries below are written on a 24-hour clock; the 12-hour one has its own test in changeIntent.spec.ts.
beforeEach(() => setHourCycle('h23'))
afterEach(() => { vi.restoreAllMocks(); setHourCycle('auto') })

describe('WebLlmProvider availability', () => {
  it('is unavailable without WebGPU', async () => {
    expect(await setup({ capabilities: { webGpu: false } }).provider.availability()).toBe('unavailable')
  })

  it('is unavailable on a device with too little memory', async () => {
    expect(await setup({ capabilities: { deviceMemoryGb: 1 } }).provider.availability()).toBe('unavailable')
  })

  it('is unavailable when the free storage cannot hold the download', async () => {
    expect(await setup({ capabilities: { storageQuotaBytes: 1e9, storageUsageBytes: 0.5e9 } }).provider.availability()).toBe('unavailable')
  })

  it('is downloadable when capable and not cached', async () => {
    expect(await setup().provider.availability()).toBe('downloadable')
  })

  it('is available from cache even without network or free storage', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    expect(await setup({ cached: true, capabilities: { storageQuotaBytes: 1e9, storageUsageBytes: 0.9e9 } }).provider.availability()).toBe('available')
  })

  it('reads the cache for the only supported model and reports its size', async () => {
    const { provider, module } = setup({ cached: true })
    await provider.availability()
    expect(module.hasModelInCache).toHaveBeenCalledWith(WEBLLM_MODEL_ID)
    expect(provider.downloadSizeBytes).toBe(705_000_000)
  })
})

describe('WebLlmProvider prepare and ask', () => {
  it('loads the model in a worker, reports progress and becomes available', async () => {
    const { provider, module } = setup()
    const progress = vi.fn()
    await provider.prepare(progress, signal())
    expect(module.CreateWebWorkerMLCEngine).toHaveBeenCalledWith(expect.anything(), WEBLLM_MODEL_ID, expect.anything())
    expect(progress).toHaveBeenCalledWith({ fraction: 0.5, text: 'half' })
    expect(await provider.availability()).toBe('available')
  })

  it('cancelling during the download stops the worker and leaves nothing loaded', async () => {
    const controller = new AbortController()
    const { provider, worker } = setup({ create: () => new Promise(() => undefined) })
    const pending = provider.prepare(vi.fn(), controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(worker.terminate).toHaveBeenCalled()
    await expect(provider.ask('hi', context(), signal())).rejects.toMatchObject({ code: 'unavailable' })
    expect(provider.lastFailure).toBeUndefined()
  })

  it('does not start when already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(setup().provider.prepare(vi.fn(), controller.signal)).rejects.toMatchObject({ code: 'cancelled' })
  })

  it('out of memory while loading marks the provider unavailable for the session', async () => {
    const { provider } = setup({ create: async () => { throw new Error('Out of memory: requested buffer exceeds maxBufferSize') } })
    await expect(provider.prepare(vi.fn(), signal())).rejects.toMatchObject({ code: 'out-of-memory' })
    expect(await provider.availability()).toBe('unavailable')
    await expect(provider.prepare(vi.fn(), signal())).rejects.toMatchObject({ code: 'unavailable' })
  })

  it('a download offline reports offline without ending the session', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { provider } = setup({ create: async () => { throw new TypeError('Failed to fetch') } })
    await expect(provider.prepare(vi.fn(), signal())).rejects.toMatchObject({ code: 'offline' })
    expect(await provider.availability()).toBe('downloadable')
  })

  it('a failed download while online is a network error, not offline, and can be retried', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true)
    const { provider } = setup({ create: async () => { throw new TypeError('Failed to fetch') } })
    await expect(provider.prepare(vi.fn(), signal())).rejects.toMatchObject({ code: 'network' })
    expect(await provider.availability()).toBe('downloadable')
  })

  it('reloading the page offline loads the cached model without network', async () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { provider } = setup({ cached: true })
    expect(await provider.availability()).toBe('available')
    await expect(provider.prepare(vi.fn(), signal())).resolves.toBeUndefined()
    await expect(provider.ask('how many hours of work?', context(), signal())).resolves.toMatchObject({ answer: expect.any(String) })
  })

  it('device lost during a reply ends the session and unloads the engine', async () => {
    const lost = fakeEngine(() => { throw new Error('GPUDevice was lost: device lost') })
    const { provider } = setup({ engine: lost })
    await provider.prepare(vi.fn(), signal())
    await expect(provider.ask('hello', context(), signal())).rejects.toMatchObject({ code: 'device-lost' })
    expect(lost.engine.unload).toHaveBeenCalled()
    expect(await provider.availability()).toBe('unavailable')
  })

  it('cancelling a reply interrupts generation', async () => {
    const controller = new AbortController()
    const slow = fakeEngine(() => new Promise<string>((resolve) => setTimeout(() => resolve('{"answer":"late"}'), 10)))
    const { provider } = setup({ engine: slow })
    await provider.prepare(vi.fn(), signal())
    const pending = provider.ask('hello', context(), controller.signal)
    await Promise.resolve()
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'cancelled' })
    expect(slow.engine.interruptGenerate).toHaveBeenCalled()
    expect(await provider.availability()).toBe('available')
  })

  it('asks with a JSON-object response format whose schema is a string', async () => {
    const { provider, engine } = setup()
    await provider.prepare(vi.fn(), signal())
    await provider.ask('hello', context(), signal())
    const request = engine.engine.create.mock.calls[0]![0] as { response_format: { type: string; schema: unknown }; temperature: number }
    expect(request.response_format.type).toBe('json_object')
    expect(typeof request.response_format.schema).toBe('string')
    expect(request.temperature).toBe(0)
  })

  it('constrains the answer template to a sentence so no bare number follows the computed facts', async () => {
    const { provider, engine } = setup()
    await provider.prepare(vi.fn(), signal())
    await provider.ask('How many hours of work this week?', context(), signal())
    const request = engine.engine.create.mock.calls[0]![0] as { messages: { content: string }[]; response_format: { schema: string } }
    expect(JSON.parse(request.response_format.schema).properties.answer.minLength).toBeGreaterThan(10)
    expect(request.messages[0]!.content).toContain('Never reply with only a number')
  })

  it('passes the computed total to the model and quotes it when the model omits it', async () => {
    const vague = fakeEngine(() => '{"answer":"You have a busy week."}')
    const { provider } = setup({ engine: vague })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask('How many hours of work this week?', context(), signal())
    const request = vague.engine.create.mock.calls[0]![0] as { messages: { content: string }[] }
    expect(request.messages[0]!.content).toContain('Work: 13 h planned this week.')
    expect(reply.answer).toBe('Work: 13 h planned this week.\n\nYou have a busy week.')
  })

  it('shows the computed facts as their own block even when the model quotes the total', async () => {
    const good = fakeEngine(() => '{"answer":"You planned 13 h of work this week."}')
    const { provider } = setup({ engine: good })
    await provider.prepare(vi.fn(), signal())
    expect((await provider.ask('How many hours of work this week?', context(), signal())).answer)
      .toBe('Work: 13 h planned this week.\n\nYou planned 13 h of work this week.')
  })

  it('does not let a wrong model figure that contains the right one hide the computed facts', async () => {
    const wrong = fakeEngine(() => '{"answer":"You planned 113 h of work this week."}')
    const { provider } = setup({ engine: wrong })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask('How many hours of work this week?', context(), signal())
    expect(reply.answer.startsWith('Work: 13 h planned this week.\n\n')).toBe(true)
    expect(reply.answer.endsWith('You planned 113 h of work this week.')).toBe(true)
  })

  it('turns a change request into a validated proposal bound to the document', async () => {
    const document = plannerWithBlocks()
    const proposing = fakeEngine(() => JSON.stringify({ intent: 'add_block', title: 'Gym', categoryName: 'work', day: 'thursday', start: '18:00', durationMinutes: 60 }))
    const { provider } = setup({ engine: proposing })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask('Add a gym block on Thursday at 18:00', contextFor(document), signal())
    expect(reply.proposal).toMatchObject({
      workspaceId: document.workspaceId, baseRevision: document.revision,
      ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Gym', days: [4], start: 1080, end: 1140 } }],
    })
    expect(reply.answer).toBe('Add "Gym" on Thursday, 18:00–19:00')
  })

  it.each([
    ['delete_block', 'Deep work', undefined],
    ['delete_block', 'Review', undefined],
    ['move_block', 'Deep work', undefined],
    ['move_block', 'Deep work', 'thursday'],
  ])('returns no proposal for %s of %s on an absent source day (%s)', async (intent, title, fromDay) => {
    const document = plannerWithBlocks()
    const before = structuredClone(document)
    const { provider } = setup({ engine: fakeEngine(() => JSON.stringify({ intent, title, day: 'thursday', fromDay, start: '10:00' })) })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask(`${intent === 'delete_block' ? 'Delete' : 'Move'} ${title} on Thursday`, contextFor(document), signal())
    expect(reply.proposal).toBeUndefined()
    expect(reply.answer).toBe(`"${title}" occurs on ${title === 'Deep work' ? 'Monday, Tuesday, Wednesday' : 'Friday'}. Which occurrence would you like to change?`)
    expect(document).toEqual(before)
  })

  it('infers Friday as the sole source for a Review move to Thursday without fromDay', async () => {
    const document = plannerWithBlocks()
    const before = structuredClone(document)
    const { provider } = setup({ engine: fakeEngine(() => JSON.stringify({ intent: 'move_block', title: 'Review', day: 'thursday', start: '10:00' })) })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask('Move Review to Thursday at 10:00', contextFor(document), signal())
    expect(reply.answer).toBe('Move "Review" to Thursday, 10:00–11:00')
    expect(reply.proposal).toMatchObject({
      workspaceId: document.workspaceId, baseRevision: document.revision,
      ops: [{ op: 'update_block', id: 'work-fri', patch: { days: [4], start: 600, end: 660 } }],
    })
    const clock = { now: () => new Date('2026-10-24T12:00:00Z') }
    const proposal = await buildProposal(reply.proposal, document, 'assistant', clock, () => 'move-proposal')
    const applied = await applyProposal(document, proposal, () => 'unused', clock)
    if (applied.kind !== 'applied') throw new Error('expected the move to apply')
    expect(applied.document.blocks).toEqual(before.blocks.map((block) => block.id === 'work-fri'
      ? { ...block, days: [4], start: 600, end: 660 }
      : block))
    expect(document).toEqual(before)
  })

  it('answers already there without splitting an unchanged Tuesday occurrence', async () => {
    const document = plannerWithBlocks()
    const before = structuredClone(document)
    const { provider } = setup({ engine: fakeEngine(() => JSON.stringify({ intent: 'move_block', title: 'Deep work', day: 'tuesday' })) })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask('Move Deep work to Tuesday', contextFor(document), signal())
    expect(reply.proposal).toBeUndefined()
    expect(reply.answer).toBe('"Deep work" is already scheduled there at that time. Nothing needs changing.')
    expect(document).toEqual(before)
  })

  it.each([
    ['10:00', undefined, 600, 840],
    ['23:00', undefined, 1380, 180],
    ['10:00', '11:30', 600, 690],
  ])('moves only Tuesday to Thursday at %s (end %s) through proposal application', async (start, end, expectedStart, expectedEnd) => {
    const document = plannerWithBlocks()
    document.blocks[0]!.notes = 'Keep focus'
    const before = structuredClone(document)
    const { provider } = setup({ engine: fakeEngine(() => JSON.stringify({ intent: 'move_block', title: 'Deep work', fromDay: 'tuesday', day: 'thursday', start, end })) })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask(`Move Tuesday Deep work to Thursday at ${start}`, contextFor(document), signal())
    expect(reply.proposal).toBeDefined()
    const clock = { now: () => new Date('2026-10-24T12:00:00Z') }
    const proposal = await buildProposal(reply.proposal, document, 'assistant', clock, () => 'move-proposal')
    const applied = await applyProposal(document, proposal, () => 'moved-occurrence', clock)
    if (applied.kind !== 'applied') throw new Error('expected the move to apply')
    expect(applied.document.blocks).toEqual([
      { ...before.blocks[0], days: [1, 3] },
      ...before.blocks.slice(1),
      { id: 'moved-occurrence', categoryId: 'work', title: 'Deep work', notes: 'Keep focus', days: [4], start: expectedStart, end: expectedEnd },
    ])
    expect(document).toEqual(before)
  })

  it('asks the model for a small intent, with examples and names but no ids or computed facts', async () => {
    const proposing = fakeEngine(() => '{"intent":"none"}')
    const { provider } = setup({ engine: proposing })
    await provider.prepare(vi.fn(), signal())
    await provider.ask('Add a gym block', context(), signal())
    const request = proposing.engine.create.mock.calls[0]![0] as { messages: { content: string }[]; response_format: { schema: string }; max_tokens: number }
    expect(Object.keys(JSON.parse(request.response_format.schema).properties)).toEqual(['intent', 'title', 'categoryName', 'day', 'fromDay', 'start', 'end', 'durationHours', 'durationMinutes', 'dueDate'])
    expect(request.messages[0]!.content).toContain('Categories: ["Work","Study"]')
    expect(request.messages[0]!.content).toContain('Request: Add a two hour Study block')
    expect(request.messages[0]!.content).not.toContain('work-am')
    expect(request.messages[1]!.content).toBe('Add a gym block')
    expect(request.max_tokens).toBeLessThanOrEqual(256)
  })

  it('answers with a friendly message, not an error, when the request names an unknown category', async () => {
    const { provider } = setup({ engine: fakeEngine(() => '{"intent":"add_block","title":"Gym","categoryName":"Fitness","day":"monday","start":"07:00"}') })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask('Add a gym block on Monday at 7', context(), signal())
    expect(reply.proposal).toBeUndefined()
    expect(reply.answer).toBe('I could not find the category "Fitness". Your categories are: Work, Study.')
  })

  it('rejects a reply that is not an intent as invalid-output without ending the session', async () => {
    const broken = fakeEngine(() => '{"summary":"x","ops":[{"op":"add_block"}]}')
    const { provider } = setup({ engine: broken })
    await provider.prepare(vi.fn(), signal())
    await expect(provider.ask('Add a gym block', context(), signal())).rejects.toMatchObject({ code: 'invalid-output' })
    expect(await provider.availability()).toBe('available')
  })
})

describe('WebLlmProvider cache management', () => {
  it('deleting the model unloads it and clears the cache entry', async () => {
    const { provider, module, engine } = setup()
    await provider.prepare(vi.fn(), signal())
    await provider.deleteModel()
    expect(engine.engine.unload).toHaveBeenCalled()
    expect(module.deleteModelAllInfoInCache).toHaveBeenCalledWith(WEBLLM_MODEL_ID)
  })

  it('dispose unloads the engine and terminates the worker', async () => {
    const { provider, worker, engine } = setup()
    await provider.prepare(vi.fn(), signal())
    await provider.dispose()
    expect(engine.engine.unload).toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalled()
  })
})

describe('failure classification and fact quoting', () => {
  it.each([
    [new Error('Out of memory'), 'out-of-memory'],
    [Object.assign(new Error('x'), { name: 'QuotaExceededError' }), 'out-of-memory'],
    [new Error('Device was lost'), 'device-lost'],
    [new TypeError('Failed to fetch'), 'network'],
    [Object.assign(new Error('x'), { name: 'AbortError' }), 'cancelled'],
    [new AssistantError('invalid-output'), 'invalid-output'],
    [new Error('boom'), 'unknown'],
  ])('classifies %s as %s', (error, expected) => {
    expect(classifyFailure(error)).toBe(expected)
  })

  it('quoteFacts leaves answers without facts untouched and never makes facts conditional on the model text', () => {
    expect(quoteFacts('hello', undefined)).toBe('hello')
    expect(quoteFacts('13  h of work', 'Work: 13 h planned this week.')).toBe('Work: 13 h planned this week.\n\n13  h of work')
    expect(quoteFacts('113 h of work', 'Work: 13 h planned this week.')).toBe('Work: 13 h planned this week.\n\n113 h of work')
    expect(quoteFacts('  ', 'Work: 13 h planned this week.')).toBe('Work: 13 h planned this week.')
  })
})
