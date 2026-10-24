import { computed, reactive, ref } from 'vue'
import type { ProposalInput } from '@/core/model'
import { RulesProvider } from './RulesProvider'
import { WebLlmProvider } from './WebLlmProvider'
import {
  AssistantError,
  type AskContext, type AssistantFailureCode, type AssistantProvider, type Availability,
} from './provider'
import { selectProvider, statusOf, type ProviderChoice } from './selectProvider'

const PREFERENCE_KEY = 'next168-assistant-provider'

export interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'notice'
  text: string
  proposal?: ProposalInput
}

function readPreference(): ProviderChoice {
  try {
    return localStorage.getItem(PREFERENCE_KEY) === 'webllm' ? 'webllm' : 'rules'
  } catch {
    return 'rules'
  }
}

function createAssistant(providers: Record<ProviderChoice, AssistantProvider>) {
  const preference = ref<ProviderChoice>(readPreference())
  const availability = reactive<Record<ProviderChoice, Availability | 'checking'>>({ rules: 'available', webllm: 'checking' })
  const progress = ref<{ fraction: number; text: string } | null>(null)
  const busy = ref<'preparing' | 'asking' | null>(null)
  const failure = ref<AssistantFailureCode | null>(null)
  const messages = ref<ChatMessage[]>([])
  let controller: AbortController | undefined
  let nextId = 0
  let prepared = false

  const active = computed<ProviderChoice>(() =>
    selectProvider(preference.value, (Object.keys(availability) as ProviderChoice[]).map((id) => ({ id, availability: availability[id] === 'checking' ? 'unavailable' : availability[id] }))))

  async function refresh(): Promise<void> {
    availability.webllm = 'checking'
    const statuses = await statusOf(providers)
    for (const status of statuses) availability[status.id] = status.availability
    if (statuses.some((status) => status.id === 'webllm' && status.availability === 'unavailable')) prepared = false
  }

  function choose(choice: ProviderChoice): void {
    preference.value = choice
    try {
      localStorage.setItem(PREFERENCE_KEY, choice)
    } catch {
      // The preference is a convenience; the in-memory value still applies.
    }
  }

  function push(role: ChatMessage['role'], text: string, proposal?: ProposalInput): void {
    messages.value.push({ id: nextId++, role, text, ...(proposal ? { proposal } : {}) })
  }

  async function prepareModel(): Promise<boolean> {
    controller = new AbortController()
    busy.value = 'preparing'
    failure.value = null
    progress.value = { fraction: 0, text: '' }
    try {
      await providers.webllm.prepare((report) => { progress.value = report }, controller.signal)
      prepared = true
      choose('webllm')
      await refresh()
      return true
    } catch (error) {
      failure.value = error instanceof AssistantError ? error.code : 'unknown'
      await refresh()
      return false
    } finally {
      busy.value = null
      progress.value = null
    }
  }

  async function ask(question: string, context: AskContext): Promise<void> {
    const text = question.trim()
    if (!text || busy.value) return
    push('user', text)
    failure.value = null
    const choice = active.value
    if (choice === 'webllm' && !prepared && !(await prepareModel())) return
    controller = new AbortController()
    busy.value = 'asking'
    try {
      const reply = await providers[active.value].ask(text, context, controller.signal)
      push('assistant', reply.answer, reply.proposal)
    } catch (error) {
      failure.value = error instanceof AssistantError ? error.code : 'unknown'
      if (failure.value === 'out-of-memory' || failure.value === 'device-lost') prepared = false
      await refresh()
    } finally {
      busy.value = null
    }
  }

  function cancel(): void {
    controller?.abort()
  }

  async function deleteModel(): Promise<void> {
    await providers.webllm.deleteModel?.()
    prepared = false
    if (preference.value === 'webllm') choose('rules')
    await refresh()
  }

  return { preference, availability, progress, busy, failure, messages, active, refresh, choose, prepareModel, ask, cancel, deleteModel, providers }
}

let shared: ReturnType<typeof createAssistant> | undefined

export function useAssistant(): ReturnType<typeof createAssistant> {
  shared ??= createAssistant({ rules: new RulesProvider(), webllm: new WebLlmProvider() })
  return shared
}

export { createAssistant }
