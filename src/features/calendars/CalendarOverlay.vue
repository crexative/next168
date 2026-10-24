<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CalendarRange } from '@/core/icsImport'
import { usePlannerStore } from '@/stores/plannerStore'
import { occurrenceKey } from './calendarOverlay'
import { useCalendarEvents } from './useCalendarEvents'
const props = defineProps<{ range: CalendarRange }>()
const { t } = useI18n(), planner = usePlannerStore()
const { events, conflicts, errors, loading } = useCalendarEvents(() => props.range)
const conflictKeys = computed(() => new Set(conflicts.value.map(occurrenceKey)))
function sourceColor(id: string): string { return `var(--cat-${planner.document?.calendarSources.find(source => source.id === id)?.colorKey ?? 'blue'})` }
function displayTime(start: string, end: string, allDay: boolean): string {
  if (allDay) return `${start} · ${t('calendars.allDay')}`
  const format = new Intl.DateTimeFormat(planner.document?.settings.locale ?? 'en', { timeZone: planner.document?.settings.timeZone ?? 'UTC', dateStyle: 'medium', timeStyle: 'short' })
  return `${format.format(new Date(start))} – ${format.format(new Date(end))}`
}
</script>
<template>
  <section class="calendar-overlay" :aria-label="t('calendars.overlay')" :aria-busy="loading">
    <p v-for="(error, id) in errors" :key="id" role="alert" class="calendar-error">{{ t(error) }}</p>
    <ul class="calendar-list">
      <li v-for="event in events" :key="occurrenceKey(event)" data-testid="calendar-occurrence" :style="{ borderInlineStart: `3px solid ${sourceColor(event.sourceId)}` }">
        <strong>{{ event.title || t('calendars.untitled') }}</strong>
        <span class="calendar-note">{{ displayTime(event.start, event.end, event.allDay) }}</span>
        <span v-if="!event.busy" class="calendar-note">{{ t('calendars.free') }}</span>
        <span v-if="conflictKeys.has(occurrenceKey(event))" data-testid="calendar-conflict" class="calendar-conflict">{{ t('calendars.conflict') }}</span>
      </li>
    </ul>
  </section>
</template>
<style scoped src="./calendars.css"></style>
