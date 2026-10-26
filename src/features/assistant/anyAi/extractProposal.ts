import { MAX_OPS_PER_PROPOSAL, proposalInputSchema, type PlannerDocument, type ProposalInput } from '@/core/model'

// Finds the proposal in the whole reply of a chat AI. The reply is prose with, ideally, one fenced block labelled
// `weeklid` (or `next168`, the label of prompts written before the rename, still in people's chats). Copying from a chat window often loses the fences, a model sometimes labels the block `json`, and
// some answer with the bare object, so each of those is read too. Nothing here applies anything.

export const MAX_REPLY_BYTES = 256 * 1024

export type ExtractFailure = 'empty' | 'tooLarge' | 'none' | 'malformed' | 'invalid' | 'tooManyOps'
// `count` is how many changes a proposal over the limit had, so the message can name both numbers.
export type ExtractResult = { ok: true; input: ProposalInput } | { ok: false; reason: ExtractFailure; count?: number }

interface Candidate { text: string; fenced: boolean }

export const PROPOSAL_LABEL = 'weeklid'
const PROPOSAL_LABELS = new Set([PROPOSAL_LABEL, 'next168'])

const FENCE = /(?:^|\n)[ \t]*(`{3,}|~{3,})[ \t]*([A-Za-z0-9_-]*)[^\n]*\n([\s\S]*?)(?:\n[ \t]*\1[ \t]*(?=\n|$)|$)/g

// The text of every balanced `{ … }` that starts outside a string, scanning like a JSON reader would.
function balancedObjects(text: string): string[] {
  const found: string[] = []
  let index = 0
  while (index < text.length) {
    const start = text.indexOf('{', index)
    if (start === -1) break
    let depth = 0, inString = false, escaped = false, end = -1
    for (let cursor = start; cursor < text.length; cursor++) {
      const char = text[cursor]!
      if (inString) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') inString = false
      } else if (char === '"') inString = true
      else if (char === '{') depth++
      else if (char === '}' && --depth === 0) { end = cursor; break }
    }
    if (end === -1) { index = start + 1; continue }
    found.push(text.slice(start, end + 1))
    index = end + 1
  }
  return found
}

function candidates(reply: string): Candidate[] {
  const labelled: Candidate[] = [], json: Candidate[] = [], plain: Candidate[] = []
  let outside = reply
  for (const match of reply.matchAll(FENCE)) {
    const label = match[2]!.toLowerCase()
    const candidate = { text: match[3]!, fenced: true }
    if (PROPOSAL_LABELS.has(label)) labelled.push(candidate)
    else if (label === 'json') json.push(candidate)
    else if (label === '') plain.push(candidate)
    outside = outside.replace(match[0], '\n')
  }
  // Without fences: any object that looks like a proposal. Prose braces are ignored rather than reported.
  const bare = balancedObjects(outside).filter((text) => /"ops"|"contractVersion"/.test(text)).map((text) => ({ text, fenced: false }))
  return [...labelled, ...json, ...plain, ...bare]
}

// Curly quotes only when the text as written is not JSON: a title may legitimately contain them.
function parseLeniently(text: string): unknown {
  try { return JSON.parse(text) } catch (error) {
    if (!/[“”]/.test(text)) throw error
    return JSON.parse(text.replace(/[“”]/g, '"'))
  }
}

export function extractProposal(reply: string): ExtractResult {
  const text = reply.replace(/\r\n?/g, '\n')
  if (!text.trim()) return { ok: false, reason: 'empty' }
  if (new TextEncoder().encode(text).length > MAX_REPLY_BYTES) return { ok: false, reason: 'tooLarge' }
  let malformed = false, invalid = false, tooMany = 0
  for (const candidate of candidates(text)) {
    let value: unknown
    try { value = parseLeniently(candidate.text.trim()) } catch { malformed = true; continue }
    if (value === null || typeof value !== 'object' || Array.isArray(value)) { if (candidate.fenced) invalid = true; continue }
    const parsed = proposalInputSchema.safeParse(value)
    if (parsed.success) return { ok: true, input: parsed.data }
    const ops = (value as { ops?: unknown }).ops
    if (Array.isArray(ops) && ops.length > MAX_OPS_PER_PROPOSAL) tooMany = Math.max(tooMany, ops.length)
    invalid = true
  }
  if (tooMany) return { ok: false, reason: 'tooManyOps', count: tooMany }
  if (invalid) return { ok: false, reason: 'invalid' }
  if (malformed || /"ops"\s*:/.test(text)) return { ok: false, reason: 'malformed' }
  return { ok: false, reason: 'none' }
}

export type MatchFailure = 'wrongWorkspace' | 'stale'

// The proposal must answer the plan as it is now: the same workspace and the revision the AI was given.
export function matchesPlan(input: ProposalInput, document: PlannerDocument): MatchFailure | null {
  if (input.workspaceId !== document.workspaceId) return 'wrongWorkspace'
  if (input.baseRevision !== document.revision) return 'stale'
  return null
}
