import { ref, watch, type Ref } from 'vue'
import type { ExternalOccurrence } from '@/core/model'

export interface OccurrenceRange { fromDate: string; days: number; timeZone: string }
export type ExternalOccurrenceSource = (range: OccurrenceRange) => Promise<ExternalOccurrence[]>

// Calendar expansion belongs to the calendars slice; it plugs its source in here.
let source: ExternalOccurrenceSource = async () => []

export function setExternalOccurrenceSource(next: ExternalOccurrenceSource): void {
  source = next
}

export function useExternalOccurrences(range: () => OccurrenceRange | null): Ref<ExternalOccurrence[]> {
  const occurrences = ref<ExternalOccurrence[]>([])
  watch(() => JSON.stringify(range()), async () => {
    const current = range()
    occurrences.value = current ? await source(current).catch(() => []) : []
  }, { immediate: true })
  return occurrences
}
