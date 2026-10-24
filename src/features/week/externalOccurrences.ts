import { ref, watch, type Ref } from 'vue'
import type { ExternalOccurrence } from '@/core/model'

export interface OccurrenceRange { fromDate: string; days: number; timeZone: string }
export type ExternalOccurrenceSource = (range: OccurrenceRange) => Promise<ExternalOccurrence[]>

// Calendar expansion belongs to the calendars slice; it plugs its source in here.
let source: ExternalOccurrenceSource = async () => []
let sourceRevision: () => unknown = () => undefined

export function setExternalOccurrenceSource(next: ExternalOccurrenceSource, revision: () => unknown = () => undefined): void {
  source = next
  sourceRevision = revision
}

export function useExternalOccurrences(range: () => OccurrenceRange | null): Ref<ExternalOccurrence[]> {
  const occurrences = ref<ExternalOccurrence[]>([])
  watch([() => JSON.stringify(range()), () => sourceRevision()], async (_, __, onCleanup) => {
    let active = true
    onCleanup(() => { active = false })
    const current = range()
    occurrences.value = []
    const expanded = current ? await source(current).catch(() => []) : []
    if (active) occurrences.value = expanded
  }, { immediate: true })
  return occurrences
}
