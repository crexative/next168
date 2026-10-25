import type { PlannerDocument, ProposalInput } from '@/core/model'

export type Availability = 'available' | 'downloadable' | 'unavailable'
export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface AskContext {
  document: PlannerDocument
  now: Date
  locale: string
  timeZone: string
  translate: Translate
  // How the on-device model stands on this device; lets the quick answers say whether turning it on is possible.
  modelAvailability?: Availability | 'checking'
}

export interface AssistantAnswer {
  answer: string
  proposal?: ProposalInput
}

export interface PrepareProgress {
  fraction: number
  text: string
}

export interface AssistantProvider {
  readonly id: string
  availability(): Promise<Availability>
  readonly downloadSizeBytes?: number
  prepare(onProgress: (progress: PrepareProgress) => void, signal: AbortSignal): Promise<void>
  ask(question: string, context: AskContext, signal: AbortSignal): Promise<AssistantAnswer>
  deleteModel?(): Promise<void>
  dispose(): Promise<void>
}

export type AssistantFailureCode =
  | 'cancelled'
  | 'offline'
  | 'network'
  // The browser could not keep the download: the device (or this site's share of it) is out of space.
  | 'storage-full'
  | 'out-of-memory'
  | 'device-lost'
  | 'invalid-output'
  | 'unavailable'
  | 'unknown'

export class AssistantError extends Error {
  readonly cause: unknown

  constructor(readonly code: AssistantFailureCode, options?: { cause?: unknown }) {
    super(code)
    this.cause = options?.cause
  }
}

// The app-wide duration format ("2 h 30 min").
export { formatDuration } from '@/ui/format'
