import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { CalendarSource, CalendarSourceStore, ColorKey } from '@/core/model'
import { CalendarImportError, icsImport, validateIcsText } from '@/core/icsImport'
import { addLocalDays, localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import { createIcsFetcher, normalizeCalendarUrl, type IcsFetcher } from './icsFetcher'

// Browser mode: coordinates calendar writes with delete-all (see BrowserPlannerRepository.ifPurgeEpoch).
export interface PurgeGuard {
  purgeEpoch(): Promise<number>
  ifPurgeEpoch(epoch: number, write: () => Promise<void>): Promise<boolean>
}
export interface CalendarServices { texts: CalendarSourceStore; fetcher: IcsFetcher; now: () => Date; newId: () => string; purgeGuard?: PurgeGuard }
let services: CalendarServices | undefined
// Data transfers can write the shared source cache before a Pinia store is mounted.
export const calendarTextRevision = ref(0)
export function configureCalendarServices(overrides: Partial<CalendarServices>): void {
  services = { texts: new IndexedDbCalendarSourceStore(), fetcher: createIcsFetcher(), now: () => new Date(), newId: () => crypto.randomUUID(), ...overrides }
}
export function calendarServices(): CalendarServices {
  if (!services) configureCalendarServices({})
  return services!
}
// Fetches in flight, so delete-all can cancel the refreshes this tab knows about.
const inFlight = new Set<AbortController>()
export function cancelCalendarRefreshes(): void {
  for (const controller of inFlight) controller.abort()
}
async function fetchCancellable(url: string): Promise<{ text: string } | { cancelled: true }> {
  const controller = new AbortController()
  inFlight.add(controller)
  try {
    const text = await calendarServices().fetcher.fetch(url, controller.signal)
    return controller.signal.aborted ? { cancelled: true } : { text }
  } catch (error) {
    if (controller.signal.aborted) return { cancelled: true }
    throw error
  } finally {
    inFlight.delete(controller)
  }
}

// The epoch of the data a calendar operation starts from; undefined where no delete-all coordination exists.
async function startEpoch(): Promise<number | undefined> {
  return calendarServices().purgeGuard?.purgeEpoch()
}
// Writes a calendar text only if no delete-all happened since `epoch`; otherwise writes nothing and fails.
async function guardedWrite(epoch: number | undefined, write: () => Promise<void>): Promise<void> {
  const guard = calendarServices().purgeGuard
  if (!guard || epoch === undefined) return write()
  if (!(await guard.ifPurgeEpoch(epoch, write))) throw new CalendarImportError('save')
}

export function calendarErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^calendars\.[a-z]+$/.test(message) ? message : 'calendars.invalid'
}

export const useCalendarStore = defineStore('calendars', () => {
  const planner = usePlannerStore()
  const rawRevision = calendarTextRevision, pending = ref(0)
  let queue: Promise<unknown> = Promise.resolve()
  let refreshedWorkspace: string | undefined
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    pending.value++
    const run = queue.then(operation, operation).finally(() => { pending.value-- })
    queue = run.catch(() => undefined)
    return run
  }
  async function commit(change: Parameters<typeof planner.commit>[0], epoch?: number): Promise<void> {
    if (!(await planner.commit(change, { purgeEpoch: epoch })).ok) throw new CalendarImportError('save')
  }
  function validate(text: string): void {
    validateIcsText(text)
    const zone = planner.document?.settings.timeZone ?? 'UTC'
    const start = localDateOf(calendarServices().now(), zone)
    icsImport(text, 'validation', { start, end: addLocalDays(start, 7) }, zone)
  }
  // `epoch` is captured when the operation starts: after a delete-all, neither the text, its rollback nor the
  // document commit may write, so a slow refresh cannot bring deleted calendar data back.
  async function persist(source: CalendarSource, text: string, epoch: number | undefined): Promise<void> {
    const { texts } = calendarServices()
    validate(text)
    const previous = await texts.get(source.id)
    await guardedWrite(epoch, () => texts.put(source.id, text))
    try {
      await commit(draft => {
        const index = draft.calendarSources.findIndex(item => item.id === source.id)
        if (index < 0) draft.calendarSources.push(source)
        else draft.calendarSources[index] = source
      }, epoch)
    } catch (error) {
      await guardedWrite(epoch, () => (previous === undefined ? texts.delete(source.id) : texts.put(source.id, previous))).catch(() => undefined)
      throw error
    }
    rawRevision.value++
  }
  function importFile(name: string, text: string): Promise<void> {
    return serialized(async () => {
      const epoch = await startEpoch()
      const { now, newId } = calendarServices()
      await persist({ id: newId(), name, kind: 'file', colorKey: 'blue', lastSyncedAt: now().toISOString() }, text, epoch)
    })
  }
  function addUrl(name: string, value: string): Promise<void> {
    return serialized(async () => {
      const epoch = await startEpoch()
      const { now, newId } = calendarServices()
      const url = normalizeCalendarUrl(value)
      const fetched = await fetchCancellable(url)
      if ('cancelled' in fetched) throw new CalendarImportError('save')
      await persist({ id: newId(), name, kind: 'url', url, colorKey: 'purple', lastSyncedAt: now().toISOString() }, fetched.text, epoch)
    })
  }
  function refreshSource(id: string): Promise<void> {
    return serialized(async () => {
      const epoch = await startEpoch()
      const source = planner.document?.calendarSources.find(source => source.id === id)
      if (!source?.url) return
      const { now } = calendarServices()
      let text: string
      try {
        const fetched = await fetchCancellable(source.url)
        if ('cancelled' in fetched) return
        text = fetched.text
        validate(text)
      } catch (error) {
        await commit(draft => {
          const current = draft.calendarSources.find(source => source.id === id)
          if (current) current.lastError = calendarErrorCode(error)
        }, epoch)
        return
      }
      // Read current metadata after the network wait so a rename in another view is retained.
      const current = planner.document?.calendarSources.find(source => source.id === id)
      if (current) await persist({ ...current, lastSyncedAt: now().toISOString(), lastError: undefined }, text, epoch)
    })
  }
  function refreshOnOpen(): Promise<void> {
    const workspace = planner.document?.workspaceId
    if (!workspace || workspace === refreshedWorkspace) return Promise.resolve()
    refreshedWorkspace = workspace
    return Promise.all(planner.document!.calendarSources.filter(source => source.kind === 'url').map(source => refreshSource(source.id))).then(() => undefined)
  }
  function updateSource(id: string, patch: { name?: string; colorKey?: ColorKey }): Promise<void> {
    return serialized(async () => {
      const epoch = await startEpoch()
      await commit(draft => {
        const source = draft.calendarSources.find(source => source.id === id)
        if (source) Object.assign(source, patch)
      }, epoch)
    })
  }
  function removeSource(id: string): Promise<void> {
    return serialized(async () => {
      // Commit metadata removal first: a failed document save must never discard the only raw copy.
      await commit(draft => { draft.calendarSources = draft.calendarSources.filter(source => source.id !== id) })
      await calendarServices().texts.delete(id)
      rawRevision.value++
    })
  }
  function restoreSource(source: CalendarSource, text: string): Promise<void> {
    return serialized(async () => persist(source, text, await startEpoch()))
  }
  return { rawRevision, pending, restoreSource, importFile, addUrl, refreshSource, refreshOnOpen, updateSource, removeSource }
})
