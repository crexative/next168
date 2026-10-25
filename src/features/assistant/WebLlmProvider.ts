import { assistantContext } from '@/core/assistantContext'
import { intentSchemaText, intentSystemPrompt } from './changeIntent'
import { probeCapabilities, type DeviceCapabilities } from './capabilities'
import { answerFromChangeReply, answerText } from './modelOutput'
import {
  AssistantError,
  type AskContext, type AssistantAnswer, type AssistantFailureCode, type AssistantProvider, type Availability, type PrepareProgress,
} from './provider'
import { answerFromStats, isChangeRequest } from './RulesProvider'

export const WEBLLM_MODEL_ID = 'Llama-3.2-1B-Instruct-q4f16_1-MLC'
export const WEBLLM_DOWNLOAD_BYTES = 705 * 1000 * 1000

const MIN_DEVICE_MEMORY_GB = 2
const STORAGE_HEADROOM = 1.5
const ANSWER_TOKENS = 256
const PROPOSAL_TOKENS = 256

export interface WebLlmEngine {
  chat: { completions: { create(request: unknown): Promise<{ choices: { message: { content: string | null } }[] }> } }
  interruptGenerate(): void | Promise<void>
  unload(): Promise<void>
}
export interface WebLlmModule {
  CreateWebWorkerMLCEngine(
    worker: Worker, modelId: string, config?: { initProgressCallback?: (report: { progress: number; text: string }) => void },
  ): Promise<WebLlmEngine>
  hasModelInCache(modelId: string): Promise<boolean>
  deleteModelAllInfoInCache(modelId: string): Promise<void>
}
export interface WebLlmDependencies {
  loadModule(): Promise<WebLlmModule>
  createWorker(): Worker
  probe(): Promise<DeviceCapabilities>
}

export const browserWebLlmDependencies: WebLlmDependencies = {
  loadModule: () => import('@mlc-ai/web-llm') as unknown as Promise<WebLlmModule>,
  createWorker: () => new Worker(new URL('../../workers/webllm.worker.ts', import.meta.url), { type: 'module' }),
  probe: () => probeCapabilities(),
}

export function classifyFailure(error: unknown): AssistantFailureCode {
  if (error instanceof AssistantError) return error.code
  const name = error instanceof Error ? error.name : ''
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (name === 'AbortError') return 'cancelled'
  // QuotaExceededError is storage, not memory: the download cannot be kept, and freeing space fixes it.
  if (name === 'QuotaExceededError' || /quota|no space|not enough space|disk (is )?full/.test(message)) return 'storage-full'
  if (/out of memory|\boom\b|allocation|maxbuffersize/.test(message)) return 'out-of-memory'
  if (/device.{0,12}lost|gpudevicelost/.test(message)) return 'device-lost'
  // Offline means the browser says so; a failed fetch while online is a network or download error worth retrying.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'offline'
  if (/failed to fetch|networkerror|network error|load failed/.test(message)) return 'network'
  return 'unknown'
}

// Compiled out of production builds: only the end-to-end build (VITE_E2E) prints the raw reply, so the
// real-model spec can record what the 1B model actually wrote.
function traceModelReply(kind: 'answer' | 'proposal', content: string): void {
  if (import.meta.env.VITE_E2E) console.info(`[next168-model-reply:${kind}] ${content}`)
}

const SESSION_ENDING = new Set<AssistantFailureCode>(['out-of-memory', 'device-lost'])

// The answer is a sentence, never a bare figure: the schema forbids very short strings, so the model cannot
// append a lone number under the computed facts.
export const MIN_ANSWER_CHARS = 24
const ANSWER_SCHEMA = { type: 'object', properties: { answer: { type: 'string', minLength: MIN_ANSWER_CHARS, maxLength: 600 } }, required: ['answer'], additionalProperties: false }

// The model explains; the numbers are the app's. The computed facts always come first, as their own block,
// whatever the model wrote: the model's prose follows on a separate paragraph and is never matched against them.
export function quoteFacts(modelAnswer: string, facts: string | undefined): string {
  if (!facts) return modelAnswer
  return modelAnswer.trim() ? `${facts}\n\n${modelAnswer}` : facts
}

export class WebLlmProvider implements AssistantProvider {
  readonly id = 'webllm'
  readonly downloadSizeBytes = WEBLLM_DOWNLOAD_BYTES
  private engine: WebLlmEngine | undefined
  private worker: Worker | undefined
  private failure: AssistantFailureCode | undefined

  constructor(private readonly dependencies: WebLlmDependencies = browserWebLlmDependencies) {}

  get lastFailure(): AssistantFailureCode | undefined {
    return this.failure
  }

  async availability(): Promise<Availability> {
    if (this.failure) return 'unavailable'
    const capabilities = await this.dependencies.probe()
    if (!capabilities.webGpu) return 'unavailable'
    if (capabilities.deviceMemoryGb !== undefined && capabilities.deviceMemoryGb < MIN_DEVICE_MEMORY_GB) return 'unavailable'
    if (this.engine) return 'available'
    const cached = await this.isCached()
    if (cached) return 'available'
    const { storageQuotaBytes, storageUsageBytes } = capabilities
    if (storageQuotaBytes !== undefined && storageQuotaBytes - (storageUsageBytes ?? 0) < WEBLLM_DOWNLOAD_BYTES * STORAGE_HEADROOM) return 'unavailable'
    return 'downloadable'
  }

  async prepare(onProgress: (progress: PrepareProgress) => void, signal: AbortSignal): Promise<void> {
    if (this.engine) return
    if (this.failure) throw new AssistantError('unavailable')
    if (signal.aborted) throw new AssistantError('cancelled')
    const worker = this.dependencies.createWorker()
    const cancelled = new Promise<never>((_, reject) => {
      signal.addEventListener('abort', () => {
        worker.terminate()
        reject(new AssistantError('cancelled'))
      }, { once: true })
    })
    let fraction = 0
    try {
      const module = await Promise.race([this.dependencies.loadModule(), cancelled])
      const engine = await Promise.race([
        module.CreateWebWorkerMLCEngine(worker, WEBLLM_MODEL_ID, {
          initProgressCallback: ({ progress, text }) => { fraction = progress; onProgress({ fraction: progress, text }) },
        }),
        cancelled,
      ])
      this.engine = engine
      this.worker = worker
    } catch (error) {
      worker.terminate()
      throw await this.failDownload(error, fraction)
    }
  }

  async ask(question: string, context: AskContext, signal: AbortSignal): Promise<AssistantAnswer> {
    const engine = this.engine
    if (!engine) throw new AssistantError(this.failure ?? 'unavailable')
    if (signal.aborted) throw new AssistantError('cancelled')

    const proposing = isChangeRequest(question)
    const facts = proposing ? undefined : answerFromStats(question, context)
    const onAbort = () => { void Promise.resolve(engine.interruptGenerate()).catch(() => undefined) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      const reply = await engine.chat.completions.create({
        messages: [
          { role: 'system', content: this.systemPrompt(context, facts, proposing) },
          { role: 'user', content: question },
        ],
        temperature: 0,
        max_tokens: proposing ? PROPOSAL_TOKENS : ANSWER_TOKENS,
        response_format: { type: 'json_object', schema: proposing ? intentSchemaText() : JSON.stringify(ANSWER_SCHEMA) },
      })
      if (signal.aborted) throw new AssistantError('cancelled')
      const content = reply.choices[0]?.message.content ?? ''
      traceModelReply(proposing ? 'proposal' : 'answer', content)
      if (proposing) return await answerFromChangeReply(content, question, context)
      return { answer: quoteFacts(answerText(content), facts) }
    } catch (error) {
      throw this.fail(signal.aborted ? new AssistantError('cancelled') : error)
    } finally {
      signal.removeEventListener('abort', onAbort)
    }
  }

  async deleteModel(): Promise<void> {
    await this.dispose()
    const module = await this.dependencies.loadModule()
    await module.deleteModelAllInfoInCache(WEBLLM_MODEL_ID)
  }

  async dispose(): Promise<void> {
    const { engine, worker } = this
    this.engine = undefined
    this.worker = undefined
    await engine?.unload().catch(() => undefined)
    worker?.terminate()
  }

  private async isCached(): Promise<boolean> {
    try {
      return await (await this.dependencies.loadModule()).hasModelInCache(WEBLLM_MODEL_ID)
    } catch {
      return false
    }
  }

  // A full disk often surfaces as a failed fetch (the browser drops a response it cannot store), so a download that
  // fails like the network does is checked against the space left for what was still to come.
  private async failDownload(error: unknown, fraction: number): Promise<AssistantError> {
    const failure = this.fail(error)
    if (failure.code !== 'network' && failure.code !== 'unknown') return failure
    const { storageQuotaBytes, storageUsageBytes } = await this.dependencies.probe().catch(() => ({ storageQuotaBytes: undefined, storageUsageBytes: undefined }))
    if (storageQuotaBytes === undefined) return failure
    const remaining = WEBLLM_DOWNLOAD_BYTES * (1 - Math.min(Math.max(fraction, 0), 1))
    return storageQuotaBytes - (storageUsageBytes ?? 0) < remaining ? new AssistantError('storage-full', { cause: error }) : failure
  }

  private fail(error: unknown): AssistantError {
    const code = classifyFailure(error)
    if (SESSION_ENDING.has(code)) {
      this.failure = code
      void this.dispose()
    }
    return error instanceof AssistantError && error.code === code ? error : new AssistantError(code, { cause: error })
  }

  private systemPrompt(context: AskContext, facts: string | undefined, proposing: boolean): string {
    if (proposing) return intentSystemPrompt(context.document, context.locale)
    const lines = [
      'You are the Next168 weekly planner assistant. Everything runs on the user\'s device.',
      `Reply in the language with code "${context.locale}".`,
      'Never calculate totals yourself: quote the computed figures below exactly.',
    ]
    if (facts) lines.push(`Computed facts (authoritative):\n${facts}`)
    lines.push('Reply with JSON of the form {"answer": "..."} using one to three full sentences of plain words. Never reply with only a number.', `Planner data: ${assistantContext(context.document)}`)
    return lines.join('\n')
  }
}
