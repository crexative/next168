import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { CalendarSource, CalendarSourceStore, ColorKey } from '@/core/model'
import { CalendarImportError, icsImport, validateIcsText } from '@/core/icsImport'
import { addLocalDays, localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import { IndexedDbCalendarSourceStore } from './calendarSourceStore'
import { createIcsFetcher, normalizeCalendarUrl, type IcsFetcher } from './icsFetcher'

export interface CalendarServices { texts: CalendarSourceStore; fetcher: IcsFetcher; now: () => Date; newId: () => string }
let services: CalendarServices | undefined
export function configureCalendarServices(overrides: Partial<CalendarServices>): void {
  services = { texts: new IndexedDbCalendarSourceStore(), fetcher: createIcsFetcher(), now: () => new Date(), newId: () => crypto.randomUUID(), ...overrides }
}
export function calendarServices(): CalendarServices {
  if (!services) configureCalendarServices({})
  return services!
}
export function calendarErrorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : ''
  return /^calendars\.[a-z]+$/.test(message) ? message : 'calendars.invalid'
}

export const useCalendarStore = defineStore('calendars', () => {
  const planner = usePlannerStore()
  const rawRevision = ref(0), pending = ref(0)
  let queue: Promise<unknown> = Promise.resolve()
  let refreshedWorkspace: string | undefined
  function serialized<T>(operation: () => Promise<T>): Promise<T> {
    pending.value++
    const run = queue.then(operation, operation).finally(() => { pending.value-- })
    queue = run.catch(() => undefined)
    return run
  }
  async function commit(change: Parameters<typeof planner.commit>[0]): Promise<void> {
    if (!(await planner.commit(change)).ok) throw new CalendarImportError('save')
  }
  function validate(text: string): void {
    validateIcsText(text)
    const zone = planner.document?.settings.timeZone ?? 'UTC'
    const start = localDateOf(calendarServices().now(), zone)
    icsImport(text, 'validation', { start, end: addLocalDays(start, 7) }, zone)
  }
  async function persist(source: CalendarSource, text: string): Promise<void> {
    const { texts } = calendarServices()
    validate(text)
    const previous = await texts.get(source.id)
    await texts.put(source.id, text)
    try {
      await commit(draft => {
        const index = draft.calendarSources.findIndex(item => item.id === source.id)
        if (index < 0) draft.calendarSources.push(source)
        else draft.calendarSources[index] = source
      })
    } catch (error) {
      if (previous === undefined) await texts.delete(source.id)
      else await texts.put(source.id, previous)
      throw error
    }
    rawRevision.value++
  }
  function importFile(name: string, text: string): Promise<void> {
    return serialized(async () => {
      const { now, newId } = calendarServices()
      await persist({ id: newId(), name, kind: 'file', colorKey: 'blue', lastSyncedAt: now().toISOString() }, text)
    })
  }
  function addUrl(name: string, value: string): Promise<void> {
    return serialized(async () => {
      const { now, newId, fetcher } = calendarServices()
      const url = normalizeCalendarUrl(value)
      const text = await fetcher.fetch(url)
      await persist({ id: newId(), name, kind: 'url', url, colorKey: 'purple', lastSyncedAt: now().toISOString() }, text)
    })
  }
  function refreshSource(id: string): Promise<void> {
    return serialized(async () => {
      const source = planner.document?.calendarSources.find(source => source.id === id)
      if (!source?.url) return
      const { now, fetcher } = calendarServices()
      let text: string
      try {
        text = await fetcher.fetch(source.url)
        validate(text)
      } catch (error) {
        await commit(draft => {
          const current = draft.calendarSources.find(source => source.id === id)
          if (current) current.lastError = calendarErrorCode(error)
        })
        return
      }
      // Read current metadata after the network wait so a rename in another view is retained.
      const current = planner.document?.calendarSources.find(source => source.id === id)
      if (current) await persist({ ...current, lastSyncedAt: now().toISOString(), lastError: undefined }, text)
    })
  }
  function refreshOnOpen(): Promise<void> {
    const workspace = planner.document?.workspaceId
    if (!workspace || workspace === refreshedWorkspace) return Promise.resolve()
    refreshedWorkspace = workspace
    return Promise.all(planner.document!.calendarSources.filter(source => source.kind === 'url').map(source => refreshSource(source.id))).then(() => undefined)
  }
  function updateSource(id: string, patch: { name?: string; colorKey?: ColorKey }): Promise<void> {
    return serialized(() => commit(draft => {
      const source = draft.calendarSources.find(source => source.id === id)
      if (source) Object.assign(source, patch)
    }))
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
    return serialized(() => persist(source, text))
  }
  return { rawRevision, pending, restoreSource, importFile, addUrl, refreshSource, refreshOnOpen, updateSource, removeSource }
})
