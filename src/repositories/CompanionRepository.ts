import { ref } from 'vue'
import {
  changeProposalSchema, plannerDocumentSchema, type CalendarSourceStore, type ChangeProposal, type LoadResult,
  type PlannerDocument, type PlannerRepository, type ProposalDecision, type ProposalHistory, type ProposalInput, type ProposalRepository, type SaveResult,
} from '@/core/model'
import { legacyChangeProposalSchema } from '@/core/legacy/v2'
import { validateDocument } from '@/core/documents'

declare global { interface Window { __NEXT168__?: { mode: 'companion' } } }
export const companionMode = typeof window !== 'undefined' && window.__NEXT168__?.mode === 'companion'
export const pairingRequired = ref(companionMode)
export const companionWarnings = ref<string[]>([])

export async function companionRequest(path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`/api${path}`, { ...init, credentials: 'same-origin', redirect: 'error', headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } })
  if (response.status === 401) { pairingRequired.value = true; throw Error('pairing-required') }
  if (response.ok) pairingRequired.value = false
  return response
}
async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json() as T & { error?: string; warnings?: string[] }
  if (payload.warnings) companionWarnings.value = payload.warnings
  if (!response.ok && response.status !== 409) throw Error(payload.error ?? `http-${response.status}`)
  return payload
}
export async function pairCompanion(code: string): Promise<void> {
  const response = await companionRequest('/pair', { method: 'POST', body: JSON.stringify({ code }) })
  await readResponse(response)
  pairingRequired.value = false
  window.dispatchEvent(new Event('next168:paired'))
}
export class CompanionRepository implements PlannerRepository {
  readonly writable = true
  async load(): Promise<LoadResult> {
    const response = await companionRequest('/document')
    const payload = await readResponse<{ document?: PlannerDocument } & Partial<LoadResult>>(response)
    if (payload.document) return { kind: 'ok', document: validateDocument(payload.document) }
    if (payload.kind === 'corrupt' || payload.kind === 'unsupported' || payload.kind === 'empty') return payload as LoadResult
    throw Error('invalid-companion-response')
  }
  save(document: PlannerDocument, expectedRevision: number): Promise<SaveResult> {
    return this.put(document, { 'If-Match': String(expectedRevision) })
  }
  // A save the server refuses (409) unless its stored document is exactly the one the caller opened on, compared inside
  // its mutex: a revision number alone repeats after a backup restore.
  saveGuarded(document: PlannerDocument, expectedRevision: number, guard: { storedFingerprint?: string; workspaceId?: string }): Promise<SaveResult> {
    return this.put(document, {
      'If-Match': String(expectedRevision),
      ...(guard.storedFingerprint ? { 'X-Weeklid-Fingerprint': guard.storedFingerprint } : {}),
      ...(guard.workspaceId ? { 'X-Weeklid-Workspace': guard.workspaceId } : {}),
    })
  }
  private async put(document: PlannerDocument, headers: Record<string, string>): Promise<SaveResult> {
    try {
      const response = await companionRequest('/document', { method: 'PUT', headers, body: JSON.stringify({ document: validateDocument(document) }) })
      return await readResponse<SaveResult>(response)
    } catch (error) { return { kind: 'error', reason: error instanceof Error ? error.message : 'save-failed' } }
  }
  subscribe(onExternalChange: () => void): () => void {
    let identity: string | undefined
    let inFlight = false
    const poll = async () => {
      if (document.visibilityState === 'hidden' || inFlight) return
      inFlight = true
      try {
        const result = await this.load()
        if (result.kind === 'ok') {
          const next = `${result.document.workspaceId}:${result.document.revision}`
          if (identity !== undefined && next !== identity) onExternalChange()
          identity = next
        }
      } catch { /* The next visible poll retries without publishing an uncommitted state. */ }
      finally { inFlight = false }
    }
    const timer = window.setInterval(() => { void poll() }, 5000)
    const visible = () => { void poll() }
    document.addEventListener('visibilitychange', visible)
    window.addEventListener('next168:paired', onExternalChange)
    void poll()
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible); window.removeEventListener('next168:paired', onExternalChange) }
  }
  async peekBackup(): Promise<PlannerDocument | undefined> {
    const response = await companionRequest('/backup')
    const payload = await readResponse<{ document: PlannerDocument | null }>(response)
    return payload.document ? plannerDocumentSchema.parse(payload.document) : undefined
  }
  async restoreBackup(): Promise<SaveResult> {
    return readResponse(await companionRequest('/backup/restore', { method: 'POST' }))
  }
}
export class CompanionProposalRepository implements ProposalRepository {
  async list(status?: ChangeProposal['status']): Promise<ChangeProposal[]> {
    const response = await companionRequest(`/proposals${status ? `?status=${status}` : ''}`)
    const payload = await readResponse<{ proposals: unknown[] }>(response)
    return payload.proposals.map(proposal => changeProposalSchema.parse(proposal))
  }
  async history(): Promise<ProposalHistory> {
    const payload = await readResponse<{ proposals: unknown[]; legacy: unknown[]; quarantine: unknown[] }>(await companionRequest('/proposals/history'))
    return {
      proposals: payload.proposals.map((proposal) => changeProposalSchema.parse(proposal)),
      legacy: payload.legacy.map((proposal) => legacyChangeProposalSchema.parse(proposal)),
      quarantine: payload.quarantine.filter((raw): raw is string => typeof raw === 'string'),
    }
  }
  async create(input: ProposalInput, source: ChangeProposal['source']): Promise<ChangeProposal> {
    const response = await companionRequest('/proposals', { method: 'POST', body: JSON.stringify({ input, source }) })
    return changeProposalSchema.parse((await readResponse<{ proposal: unknown }>(response)).proposal)
  }
  async approve(id: string, contentHash: string, baseRevision: number): Promise<ProposalDecision> {
    return readResponse(await companionRequest(`/proposals/${encodeURIComponent(id)}/apply`, { method: 'POST', body: JSON.stringify({ contentHash, baseRevision }) }))
  }
  async reject(id: string): Promise<ProposalDecision> {
    return readResponse(await companionRequest(`/proposals/${encodeURIComponent(id)}/reject`, { method: 'POST' }))
  }
}
export class CompanionCalendarSourceStore implements CalendarSourceStore {
  async get(sourceId: string): Promise<string | undefined> {
    const response = await companionRequest(`/calendars/${encodeURIComponent(sourceId)}`)
    if (response.status === 404) return undefined
    if (!response.ok) throw Error('calendar-load-failed')
    return response.text()
  }
  async put(sourceId: string, icsText: string): Promise<void> {
    await readResponse(await companionRequest(`/calendars/${encodeURIComponent(sourceId)}`, { method: 'PUT', headers: { 'Content-Type': 'text/calendar' }, body: icsText }))
  }
  async delete(sourceId: string): Promise<void> {
    await readResponse(await companionRequest(`/calendars/${encodeURIComponent(sourceId)}`, { method: 'DELETE' }))
  }
  async list(): Promise<string[]> {
    return (await readResponse<{ ids: string[] }>(await companionRequest('/calendars'))).ids
  }
}
