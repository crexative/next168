import { afterEach, expect, it, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import type { ProposalRepository } from '@/core/model'
import { STORAGE_KEYS } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { calendarExport } from '@/core/calendarExport'
import { LocalStorageRepository } from '@/repositories/LocalStorageRepository'
import { LocalStorageProposalRepository } from '@/repositories/LocalStorageProposalRepository'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { i18n } from '@/i18n'
import ProposalsView from './ProposalsView.vue'

let repository: ProposalRepository
vi.mock('./repository', () => ({ getProposalRepository: () => repository }))
let app: App | undefined
let host: HTMLElement | undefined
afterEach(() => { app?.unmount(); host?.remove(); vi.restoreAllMocks() })
it('shows the exact proposal without applying it, then commits only on the explicit Approve click', async () => {
  const values = new Map<string, string>()
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, removeItem: (key: string) => { values.delete(key) } }
  const now = () => new Date('2026-10-24T10:00:00Z')
  const newId = () => crypto.randomUUID()
  const document = createEmptyDocument({ now: now(), locale: 'en', timeZone: 'UTC' })
  document.categories = [{ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }]
  values.set(STORAGE_KEYS.document, JSON.stringify(document))
  const runExclusive = async <T,>(task: () => Promise<T>) => task()
  const plannerRepository = new LocalStorageRepository({ storage, events: new EventTarget(), runExclusive, now, newId, locale: () => 'en', timeZone: () => 'UTC' })
  repository = new LocalStorageProposalRepository({ storage, runExclusive, now, newId })
  const event = { title: 'Holiday', allDay: true, start: '2026-10-24T00:00:00+14:00', end: '2026-10-25T00:00:00+14:00', attendees: [] }
  const proposal = await repository.create({ contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: 0, summary: 'A focused hour', ops: [
    { op: 'add_block', block: { categoryId: 'focus', title: 'Focused planning', days: [1], start: 540, end: 600 } },
    { op: 'add_event', event },
  ] }, 'import')
  const approve = vi.spyOn(repository, 'approve')
  const pinia = createPinia(); setActivePinia(pinia)
  configurePlannerStore({ repository: plannerRepository, now, newId, locale: () => 'en', timeZone: () => 'UTC' })
  const planner = usePlannerStore(pinia); await planner.load()
  host = window.document.createElement('div'); window.document.body.append(host)
  app = createApp(ProposalsView).use(pinia).use(i18n); app.mount(host)
  await vi.waitFor(() => expect(host!.textContent).toContain('A focused hour'))
  const review = [...host.querySelectorAll('button')].find(button => button.textContent?.includes('A focused hour'))!
  review.click()
  await vi.waitFor(() => expect(window.document.querySelector('[role="dialog"]')?.textContent).toContain('Focused planning'))
  const after = window.document.querySelector('[data-testid="change-after"]')!
  expect(after.textContent).toContain('Focused planning')
  expect(after.textContent).toContain('Focus')
  expect(after.textContent).toContain('Mon')
  expect(after.textContent).toContain('9:00 AM – 10:00 AM')
  expect(after.textContent).not.toMatch(/categoryId|preview-1|"start"/)
  const eventSummary = window.document.querySelectorAll('[data-testid="change-after"]')[1]!
  expect(eventSummary.textContent).toContain('Oct 24, 2026 – Oct 24, 2026')
  expect(eventSummary.textContent).not.toContain('Oct 23')
  const raw = window.document.querySelector<HTMLDetailsElement>('[role="dialog"] details.raw')!
  expect(raw.open).toBe(false)
  expect(raw.querySelector('pre')?.textContent).toContain('"categoryId"')
  expect(approve).not.toHaveBeenCalled()
  expect(planner.document?.blocks).toHaveLength(0)
  expect(planner.document?.events).toHaveLength(0)
  const button = [...window.document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find(button => button.textContent?.trim() === 'Approve')!
  await vi.waitFor(() => expect(button.disabled).toBe(false))
  button.click()
  await vi.waitFor(() => expect(planner.document?.blocks).toHaveLength(1))
  expect(approve).toHaveBeenCalledExactlyOnceWith(proposal.id, proposal.contentHash, 0)
  await nextTick()
  expect(host.querySelector('[data-testid="applied-blocks"]')?.textContent).toContain('Focused planning')
  expect(planner.document?.revision).toBe(1)
  expect(planner.document?.events).toEqual([expect.objectContaining(event)])
  expect(calendarExport(planner.document!.events, { now }))
    .toContain('DTSTART;VALUE=DATE:20261024\r\nDTEND;VALUE=DATE:20261025')
})
