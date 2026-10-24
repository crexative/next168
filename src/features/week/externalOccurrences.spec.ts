import { afterEach, expect, it } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import type { ExternalOccurrence } from '@/core/model'
import { setExternalOccurrenceSource, useExternalOccurrences } from './externalOccurrences'

const event: ExternalOccurrence = { sourceId: 'team', uid: 'event', title: 'Obsolete', start: '2026-10-24T12:00:00.000Z', end: '2026-10-24T13:00:00.000Z', allDay: false, busy: true }
afterEach(() => { setExternalOccurrenceSource(async () => []) })

it('discards superseded results when ranges change and when the consumer stops', async () => {
  const pending: ((events: ExternalOccurrence[]) => void)[] = []
  setExternalOccurrenceSource(() => new Promise(resolve => { pending.push(resolve) }))
  const range = ref({ fromDate: '2026-10-24', days: 7, timeZone: 'UTC' })
  const scope = effectScope()
  const occurrences = scope.run(() => useExternalOccurrences(() => range.value))!
  try {
    range.value = { ...range.value, fromDate: '2026-10-25' }
    await nextTick()
    expect(pending).toHaveLength(2)
    pending[1]!([])
    await nextTick()
    pending[0]!([event])
    await nextTick()
    await nextTick()
    expect(occurrences.value).toEqual([])

    range.value = { ...range.value, fromDate: '2026-10-26' }
    await nextTick()
    scope.stop()
    pending[2]!([event])
    await nextTick()
    expect(occurrences.value).toEqual([])
  } finally { scope.stop() }
})

it('keeps the previous occurrences while a new expansion is pending', async () => {
  const pending: ((events: ExternalOccurrence[]) => void)[] = []
  const revision = ref(0)
  const range = ref({ fromDate: '2026-10-24', days: 7, timeZone: 'UTC' })
  setExternalOccurrenceSource(() => new Promise(resolve => { pending.push(resolve) }), () => revision.value)
  const scope = effectScope()
  const occurrences = scope.run(() => useExternalOccurrences(() => range.value))!
  try {
    pending[0]!([event])
    await nextTick(); await nextTick()
    expect(occurrences.value).toEqual([event])

    revision.value++
    await nextTick()
    expect(pending).toHaveLength(2)
    expect(occurrences.value).toEqual([event])
    pending[1]!([{ ...event, title: 'Renamed' }])
    await nextTick(); await nextTick()
    expect(occurrences.value.map(item => item.title)).toEqual(['Renamed'])
  } finally { scope.stop() }
})
