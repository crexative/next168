import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DeviceCapabilities } from './capabilities'
import { AssistantError, type AskContext } from './provider'
import {
  WEBLLM_MODEL_ID, WebLlmProvider, classifyFailure, quoteFacts,
  type WebLlmDependencies, type WebLlmEngine, type WebLlmModule,
} from './WebLlmProvider'
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

afterEach(() => vi.restoreAllMocks())

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
    const { provider } = setup({ create: async () => { throw new TypeError('Failed to fetch') } })
    await expect(provider.prepare(vi.fn(), signal())).rejects.toMatchObject({ code: 'offline' })
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

  it('passes the computed total to the model and quotes it when the model omits it', async () => {
    const vague = fakeEngine(() => '{"answer":"You have a busy week."}')
    const { provider } = setup({ engine: vague })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask('How many hours of work this week?', context(), signal())
    const request = vague.engine.create.mock.calls[0]![0] as { messages: { content: string }[] }
    expect(request.messages[0]!.content).toContain('Work: 13 h planned this week.')
    expect(reply.answer).toBe('Work: 13 h planned this week.\nYou have a busy week.')
  })

  it('keeps the model wording when it already quotes the total', async () => {
    const good = fakeEngine(() => '{"answer":"You planned 13 h of work this week."}')
    const { provider } = setup({ engine: good })
    await provider.prepare(vi.fn(), signal())
    expect((await provider.ask('How many hours of work this week?', context(), signal())).answer).toBe('You planned 13 h of work this week.')
  })

  it('turns a change request into a validated proposal bound to the document', async () => {
    const document = plannerWithBlocks()
    const proposing = fakeEngine(() => JSON.stringify({
      summary: 'Gym on Thursday evening',
      ops: [{ op: 'add_block', block: { categoryId: 'work', title: 'Gym', days: [4], start: 1080, end: 1140 } }],
    }))
    const { provider } = setup({ engine: proposing })
    await provider.prepare(vi.fn(), signal())
    const reply = await provider.ask('Add a gym block on Thursday at 18:00', contextFor(document), signal())
    expect(reply.proposal).toMatchObject({ workspaceId: document.workspaceId, baseRevision: document.revision })
    expect(reply.answer).toBe('Gym on Thursday evening')
  })

  it('rejects invalid model JSON for a proposal as invalid-output', async () => {
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
    [new TypeError('Failed to fetch'), 'offline'],
    [Object.assign(new Error('x'), { name: 'AbortError' }), 'cancelled'],
    [new AssistantError('invalid-output'), 'invalid-output'],
    [new Error('boom'), 'unknown'],
  ])('classifies %s as %s', (error, expected) => {
    expect(classifyFailure(error)).toBe(expected)
  })

  it('quoteFacts leaves answers without facts untouched and accepts spacing differences', () => {
    expect(quoteFacts('hello', undefined)).toBe('hello')
    expect(quoteFacts('13  h of work', 'Work: 13 h planned this week.')).toBe('13  h of work')
  })
})
