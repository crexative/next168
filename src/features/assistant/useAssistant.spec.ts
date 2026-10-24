import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantError, type AssistantProvider, type Availability } from './provider'
import { RulesProvider } from './RulesProvider'
import { createAssistant } from './useAssistant'
import { contextFor, plannerWithBlocks } from './testSupport'

function fakeModel(initial: Availability) {
  let state = initial
  const model: AssistantProvider = {
    id: 'webllm',
    availability: async () => state,
    prepare: vi.fn(async (onProgress) => { onProgress({ fraction: 0.4, text: 'loading' }); state = 'available' }),
    ask: vi.fn(async () => ({ answer: 'from the model' })),
    deleteModel: vi.fn(async () => { state = 'downloadable' }),
    dispose: async () => undefined,
  }
  return { model, setState: (next: Availability) => { state = next } }
}

const context = () => contextFor(plannerWithBlocks())

beforeEach(() => localStorage.clear())

describe('assistant state', () => {
  it('never downloads without the explicit opt-in call', async () => {
    const { model } = fakeModel('downloadable')
    const assistant = createAssistant({ rules: new RulesProvider(), webllm: model })
    assistant.choose('webllm')
    await assistant.refresh()
    await assistant.ask('How many hours of work this week?', context())
    expect(model.prepare).not.toHaveBeenCalled()
    expect(assistant.active.value).toBe('rules')
    expect(assistant.messages.value.at(-1)?.text).toBe('Work: 13 h planned this week.')
  })

  it('opting in prepares the model, switches to it and answers from it', async () => {
    const { model } = fakeModel('downloadable')
    const assistant = createAssistant({ rules: new RulesProvider(), webllm: model })
    await assistant.refresh()
    expect(await assistant.prepareModel()).toBe(true)
    expect(assistant.preference.value).toBe('webllm')
    expect(localStorage.getItem('next168-assistant-provider')).toBe('webllm')
    await assistant.ask('anything', context())
    expect(assistant.messages.value.at(-1)?.text).toBe('from the model')
  })

  it('a failed download keeps the failure code and falls back to quick answers', async () => {
    const { model } = fakeModel('downloadable')
    model.prepare = vi.fn(async () => { throw new AssistantError('offline') })
    const assistant = createAssistant({ rules: new RulesProvider(), webllm: model })
    await assistant.refresh()
    expect(await assistant.prepareModel()).toBe(false)
    expect(assistant.failure.value).toBe('offline')
    expect(assistant.preference.value).toBe('rules')
  })

  it('invalid model output surfaces a retryable failure and the chat stays usable', async () => {
    const { model } = fakeModel('available')
    model.ask = vi.fn()
      .mockRejectedValueOnce(new AssistantError('invalid-output'))
      .mockResolvedValueOnce({ answer: 'second try' })
    const assistant = createAssistant({ rules: new RulesProvider(), webllm: model })
    assistant.choose('webllm')
    await assistant.refresh()
    await assistant.ask('first', context())
    expect(assistant.failure.value).toBe('invalid-output')
    await assistant.ask('second', context())
    expect(assistant.failure.value).toBeNull()
    expect(assistant.messages.value.at(-1)?.text).toBe('second try')
  })

  it('deleting the model returns to quick answers', async () => {
    const { model } = fakeModel('available')
    const assistant = createAssistant({ rules: new RulesProvider(), webllm: model })
    assistant.choose('webllm')
    await assistant.refresh()
    await assistant.deleteModel()
    expect(model.deleteModel).toHaveBeenCalled()
    expect(assistant.preference.value).toBe('rules')
    expect(assistant.availability.webllm).toBe('downloadable')
  })
})
