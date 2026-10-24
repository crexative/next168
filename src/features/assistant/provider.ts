import type { PlannerDocument, ProposalInput } from '@/core/model'

export type Availability = 'available' | 'downloadable' | 'unavailable'
export type Translate = (key: string, params?: Record<string, unknown>) => string

export interface AskContext {
  document: PlannerDocument
  now: Date
  locale: string
  timeZone: string
  translate: Translate
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

export function formatDuration(minutes: number): string {
  const rounded = Math.round(minutes)
  const hours = Math.floor(rounded / 60)
  const rest = rounded % 60
  if (rest === 0) return `${hours} h`
  return hours === 0 ? `${rest} min` : `${hours} h ${rest} min`
}
