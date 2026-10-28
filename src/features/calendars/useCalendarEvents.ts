import { computed, ref, toValue, watch, type MaybeRefOrGetter } from 'vue'
import type { ExternalOccurrence } from '@/core/model'
import { icsImport, type CalendarRange } from '@/core/icsImport'
import { addLocalDays, localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import { calendarErrorCode, calendarServices, useCalendarStore } from './calendarStore'
import { calendarOverlay } from './calendarOverlay'
import { googleOccurrencesIn, googleRevision } from './googleCalendar'

// A range given as instants covers every civil date it touches.
function civilRange({ start, end }: CalendarRange, timeZone: string): { start: string; end: string } {
  return {
    start: start.length === 10 ? start : localDateOf(start, timeZone),
    end: end.length === 10 ? end : addLocalDays(localDateOf(end, timeZone), 1),
  }
}

export function useCalendarEvents(range: MaybeRefOrGetter<CalendarRange>) {
  const planner = usePlannerStore(), calendars = useCalendarStore()
  const events = ref<ExternalOccurrence[]>([]), errors = ref<Record<string, string>>({}), loading = ref(false)
  let generation = 0
  watch(() => [planner.document, toValue(range).start, toValue(range).end, calendars.rawRevision, googleRevision()], async () => {
    const current = ++generation
    const document = planner.document
    if (!document) { events.value = []; return }
    loading.value = true
    const expanded: ExternalOccurrence[] = [], failures: [string, string][] = []
    for (const source of document.calendarSources) {
      try {
        const text = await calendarServices().texts.get(source.id)
        // A file can only be imported again; a subscription can be downloaded again.
        if (text === undefined) failures.push([source.id, source.kind === 'url' ? 'calendars.missingUrl' : 'calendars.missingFile'])
        else expanded.push(...icsImport(text, source.id, toValue(range), document.settings.timeZone))
      } catch (error) { failures.push([source.id, calendarErrorCode(error)]) }
    }
    if (current !== generation) return
    expanded.push(...googleOccurrencesIn(civilRange(toValue(range), document.settings.timeZone), document.settings.timeZone))
    events.value = expanded
    errors.value = Object.fromEntries(failures)
    loading.value = false
  }, { immediate: true })
  watch(() => planner.document?.workspaceId, () => { void calendars.refreshOnOpen().catch(error => { errors.value = { ...errors.value, refresh: calendarErrorCode(error) } }) }, { immediate: true })
  const overlay = computed(() => planner.document ? calendarOverlay(planner.document, events.value, toValue(range)) : { events: [], busy: [], conflicts: [], conflictingBlockIds: [] })
  return { events, occurrences: events, busy: computed(() => overlay.value.busy), conflicts: computed(() => overlay.value.conflicts), conflictingBlockIds: computed(() => overlay.value.conflictingBlockIds), errors, loading }
}
