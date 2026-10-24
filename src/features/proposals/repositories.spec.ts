import { afterEach, describe, expect, it, vi } from 'vitest'
import { CompanionProposalRepository, CompanionRepository, CompanionCalendarSourceStore, pairingRequired } from '@/repositories/CompanionRepository'
import { createEmptyDocument } from '@/core/documents'
import { snapshotAndPrompt } from '../settings/connect/transfer'

afterEach(() => vi.unstubAllGlobals())
describe('companion browser adapters', () => {
  it('uses only the same-origin session cookie and sends conditional document writes', async () => {
    const document = createEmptyDocument({ now: new Date(), locale: 'en', timeZone: 'UTC' })
    document.revision = 1
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: 'ok', revision: 1 }), { status: 200 }))
    vi.stubGlobal('fetch', fetch)
    expect(await new CompanionRepository().save(document, 0)).toEqual({ kind: 'ok', revision: 1 })
    expect(fetch).toHaveBeenCalledWith('/api/document', expect.objectContaining({ method: 'PUT', credentials: 'same-origin', redirect: 'error', headers: { 'Content-Type': 'application/json', 'If-Match': '0' } }))
  })
  it('surfaces stale approval and binds hash and revision', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ kind: 'stale', currentRevision: 9 }), { status: 409 }))
    vi.stubGlobal('fetch', fetch)
    expect(await new CompanionProposalRepository().approve('proposal', 'hash', 8)).toEqual({ kind: 'stale', currentRevision: 9 })
    expect(fetch).toHaveBeenCalledWith('/api/proposals/proposal/apply', expect.objectContaining({ body: JSON.stringify({ contentHash: 'hash', baseRevision: 8 }) }))
  })
  it('requires pairing after a 401 without falling back to browser storage', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })))
    await expect(new CompanionRepository().load()).rejects.toThrow('pairing-required')
    expect(pairingRequired.value).toBe(true)
  })
  it('round-trips calendar text through the authenticated API', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response('{}')).mockResolvedValueOnce(new Response('BEGIN:VCALENDAR'))
    vi.stubGlobal('fetch', fetch)
    const sources = new CompanionCalendarSourceStore()
    await sources.put('source/with/slash', 'BEGIN:VCALENDAR')
    expect(await sources.get('source/with/slash')).toBe('BEGIN:VCALENDAR')
    expect(fetch).toHaveBeenCalledWith('/api/calendars/source%2Fwith%2Fslash', expect.objectContaining({ method: 'PUT', credentials: 'same-origin' }))
  })
  it('exports the proposal contract and workspace without private block notes', () => {
    const document = createEmptyDocument({ now: new Date(), locale: 'en', timeZone: 'UTC' })
    document.blocks.push({ id: 'block', title: 'Focus', categoryId: 'focus', notes: 'private note', days: [1], start: 540, end: 600 })
    const prompt = snapshotAndPrompt(document)
    expect(prompt).toContain(document.workspaceId)
    expect(prompt).toContain('baseRevision')
    expect(prompt).toContain('contractVersion')
    expect(prompt).not.toContain('private note')
  })
})
