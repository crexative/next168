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
  // The purge epoch of the planner this tab shows; read synchronously when a user action starts.
  knownPurgeEpoch(): number | undefined
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

// The purge epoch a calendar action is bound to, captured synchronously when the user initiates it (never when
// queued work finally runs, which can be after a delete-all). Undefined where no delete-all coordination exists;
// NaN, which matches no stored epoch, when this tab has not loaded its planner yet.
export function capturePurgeEpoch(): number | undefined {
  const guard = calendarServices().purgeGuard
  return guard ? guard.knownPurgeEpoch() ?? Number.NaN : undefined
}
// Runs a calendar text write only if no delete-all happened since `epoch`; resolves false when it wrote nothing.
export async function writeIfUnpurged(epoch: number | undefined, write: () => Promise<void>): Promise<boolean> {
  const guard = calendarServices().purgeGuard
  if (!guard || epoch === undefined) {
    await write()
    return true
  }
  return guard.ifPurgeEpoch(epoch, write)
}
async function guardedWrite(epoch: number | undefined, write: () => Promise<void>): Promise<void> {
  if (!(await writeIfUnpurged(epoch, write))) throw new CalendarImportError('save')
}

// What a calendar action was initiated on: the workspace and the purge epoch the user saw.
export interface CalendarIntent { workspaceId: string | undefined; epoch: number | undefined }

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
  function captureIntent(): CalendarIntent {
    return { workspaceId: planner.document?.workspaceId, epoch: capturePurgeEpoch() }
  }
  // Refused when the planner was reset (purge epoch) or replaced (workspace) since the action was initiated.
  async function commit(change: Parameters<typeof planner.commit>[0], intent: CalendarIntent): Promise<void> {
    const result = await planner.commit(draft => {
      if (intent.workspaceId !== undefined && draft.workspaceId !== intent.workspaceId) throw new CalendarImportError('save')
      change(draft)
    }, { purgeEpoch: intent.epoch })
    if (!result.ok) throw new CalendarImportError('save')
  }
  function validate(text: string): void {
    validateIcsText(text)
    const zone = planner.document?.settings.timeZone ?? 'UTC'
    const start = localDateOf(calendarServices().now(), zone)
    icsImport(text, 'validation', { start, end: addLocalDays(start, 7) }, zone)
  }
  // After a delete-all or a replaced workspace, neither the text, its rollback nor the document commit may write,
  // so queued or slow work cannot bring deleted calendar data back.
  async function persist(source: CalendarSource, text: string, intent: CalendarIntent): Promise<void> {
    const { texts } = calendarServices()
    validate(text)
    const previous = await texts.get(source.id)
    await guardedWrite(intent.epoch, () => texts.put(source.id, text))
    try {
      await commit(draft => {
        const index = draft.calendarSources.findIndex(item => item.id === source.id)
        if (index < 0) draft.calendarSources.push(source)
        else draft.calendarSources[index] = source
      }, intent)
    } catch (error) {
      await guardedWrite(intent.epoch, () => (previous === undefined ? texts.delete(source.id) : texts.put(source.id, previous))).catch(() => undefined)
      throw error
    }
    rawRevision.value++
  }
  // Every public action captures its intent synchronously, before it joins the queue. Callers that await something
  // first (a file read, an open sheet, an undo toast) capture it at the user's gesture and pass it in.
  function importFile(name: string, text: string, intent: CalendarIntent = captureIntent()): Promise<void> {
    return serialized(async () => {
      const { now, newId } = calendarServices()
      await persist({ id: newId(), name, kind: 'file', colorKey: 'blue', lastSyncedAt: now().toISOString() }, text, intent)
    })
  }
  function addUrl(name: string, value: string): Promise<void> {
    const intent = captureIntent()
    return serialized(async () => {
      const { now, newId } = calendarServices()
      const url = normalizeCalendarUrl(value)
      const fetched = await fetchCancellable(url)
      if ('cancelled' in fetched) throw new CalendarImportError('save')
      await persist({ id: newId(), name, kind: 'url', url, colorKey: 'purple', lastSyncedAt: now().toISOString() }, fetched.text, intent)
    })
  }
  function refreshSource(id: string, intent: CalendarIntent = captureIntent()): Promise<void> {
    return serialized(async () => {
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
        }, intent)
        return
      }
      // Read current metadata after the network wait so a rename in another view is retained.
      const current = planner.document?.calendarSources.find(source => source.id === id)
      if (current) await persist({ ...current, lastSyncedAt: now().toISOString(), lastError: undefined }, text, intent)
    })
  }
  function refreshOnOpen(): Promise<void> {
    const workspace = planner.document?.workspaceId
    if (!workspace || workspace === refreshedWorkspace) return Promise.resolve()
    refreshedWorkspace = workspace
    // Each refreshSource call below captures its intent synchronously, i.e. now.
    return Promise.all(planner.document!.calendarSources.filter(source => source.kind === 'url').map(source => refreshSource(source.id))).then(() => undefined)
  }
  function updateSource(id: string, patch: { name?: string; colorKey?: ColorKey }): Promise<void> {
    const intent = captureIntent()
    return serialized(() => commit(draft => {
      const source = draft.calendarSources.find(source => source.id === id)
      if (source) Object.assign(source, patch)
    }, intent))
  }
  function removeSource(id: string, intent: CalendarIntent = captureIntent()): Promise<void> {
    return serialized(async () => {
      // Commit metadata removal first: a failed document save must never discard the only raw copy.
      await commit(draft => { draft.calendarSources = draft.calendarSources.filter(source => source.id !== id) }, intent)
      await calendarServices().texts.delete(id)
      rawRevision.value++
    })
  }
  // An undo passes the intent of the removal it undoes, so it is bound to the planner the source was removed from.
  function restoreSource(source: CalendarSource, text: string, intent: CalendarIntent = captureIntent()): Promise<void> {
    return serialized(() => persist(source, text, intent))
  }
  // A planner write (for example an event) bound to the intent captured at the user's gesture.
  function commitWithIntent(change: Parameters<typeof planner.commit>[0], intent: CalendarIntent): Promise<void> {
    return commit(change, intent)
  }
  return { rawRevision, pending, captureIntent, commitWithIntent, restoreSource, importFile, addUrl, refreshSource, refreshOnOpen, updateSource, removeSource }
})
