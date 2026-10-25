<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerEvent } from '@/core/model'
import { addLocalDays, localDateOf, zonedInstant } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Sheet from '@/ui/Sheet.vue'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import { useCalendarStore, type CalendarIntent } from './calendarStore'
import { buildEvent, draftFromEvent, minutesOf, type EventDraft } from './eventDraft'
const { t: eventText } = useI18n({ useScope: 'local', messages: { en: { through: 'Through' }, es: { through: 'Hasta el' }, fr: { through: 'Jusqu’au' }, pt: { through: 'Até o dia' }, de: { through: 'Bis einschließlich' } } })
const props = defineProps<{ open: boolean; event?: PlannerEvent }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()
const { t } = useI18n(), planner = usePlannerStore(), calendars = useCalendarStore()
// Captured when the sheet opens: a save after the planner was reset or replaced writes nothing.
let intent: CalendarIntent | undefined
const moreId = useId()
const draft = reactive<EventDraft>({ title: '', date: '', time: '09:00', allDay: false, duration: 60, location: '', notes: '', attendees: '' })
const initial = ref(''), saving = ref(false), error = ref(''), attempted = ref(false), moreOpen = ref(false)
const zone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
const startInstant = computed(() => {
  try { return zonedInstant(draft.date, minutesOf(draft.time), zone.value) } catch { return undefined }
})
const endInstant = computed(() => startInstant.value && Number.isFinite(draft.duration)
  ? new Date(startInstant.value.getTime() + draft.duration * 60000) : undefined)
// Resolve both local endpoints before subtracting: a wall-clock hour may cross a DST gap or fold.
const endTime = computed({
  get: () => endInstant.value ? new Intl.DateTimeFormat('en-GB', { timeZone: zone.value, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(endInstant.value) : '',
  set: (value: string) => {
    if (!startInstant.value || !/^\d{2}:\d{2}$/.test(value)) { draft.duration = NaN; return }
    const date = addLocalDays(draft.date, minutesOf(value) < minutesOf(draft.time) ? 1 : 0)
    const end = zonedInstant(date, minutesOf(value), zone.value)
    draft.duration = (end.getTime() - startInstant.value.getTime()) / 60000
  },
})
// All-day storage uses an exclusive end; the date shown to a person is the last included day.
const allDayEnd = computed({
  get: () => { try { return addLocalDays(draft.date, draft.duration - 1) } catch { return '' } },
  set: (value: string) => { draft.duration = (Date.parse(value) - Date.parse(draft.date)) / 86400000 + 1 },
})
const dirty = computed(() => JSON.stringify(draft) !== initial.value)
const valid = computed(() => { try { buildEvent(draft, props.event?.id ?? 'preview', zone.value); return true } catch { return false } })
watch(() => props.open, open => {
  if (!open) return
  intent = calendars.captureIntent()
  Object.assign(draft, props.event ? draftFromEvent(props.event, zone.value) : { title: '', date: localDateOf(new Date(), zone.value), time: '09:00', allDay: false, duration: 60, location: '', notes: '', attendees: '' })
  initial.value = JSON.stringify(draft); error.value = ''; attempted.value = false
  // Location and notes stay one level deeper unless the event already has them.
  moreOpen.value = Boolean(draft.location || draft.notes)
}, { immediate: true })
async function save(): Promise<void> {
  attempted.value = true
  if (!valid.value || saving.value) return
  saving.value = true
  let event: PlannerEvent
  try { event = buildEvent(draft, props.event?.id ?? crypto.randomUUID(), zone.value) } catch {
    error.value = 'calendars.formInvalid'
    saving.value = false
    return
  }
  try {
    await calendars.commitWithIntent(doc => {
      const index = doc.events.findIndex(item => item.id === event.id)
      if (index < 0) doc.events.push(event)
      else doc.events[index] = event
    }, intent ?? calendars.captureIntent())
    emit('update:open', false)
  } catch { error.value = 'calendars.save' }
  finally { saving.value = false }
}
</script>
<template>
  <Sheet :open="open" :title="t(event ? 'calendars.editEvent' : 'calendars.newEvent')" :dirty="dirty" @update:open="emit('update:open', $event)">
    <form class="calendar-form event-form" @submit.prevent="save">
      <label>{{ t('calendars.title') }}<input v-model="draft.title" required maxlength="120" autocomplete="off"></label>
      <label>{{ t('calendars.date') }}<input v-model="draft.date" type="date" required></label>
      <label class="checkbox"><input v-model="draft.allDay" type="checkbox" @change="draft.duration = draft.allDay ? 1 : 60">{{ t('calendars.allDay') }}</label>
      <label v-if="draft.allDay">{{ eventText('through') }}<input v-model="allDayEnd" type="date" :min="draft.date" required data-testid="event-end-date"></label>
      <div v-else class="time-range">
        <label>{{ t('calendars.time') }}<input v-model="draft.time" type="time" required></label>
        <label>{{ t('calendars.until') }}<input v-model="endTime" type="time" required></label>
      </div>
      <button type="button" class="more-toggle t-subhead" :aria-expanded="moreOpen" :aria-controls="moreId" data-testid="event-more" @click="moreOpen = !moreOpen">
        {{ t('calendars.more') }}
        <Icon :name="moreOpen ? 'chevron-up' : 'chevron-down'" :size="16" />
      </button>
      <div v-show="moreOpen" :id="moreId" class="more-fields">
        <label>{{ t('calendars.location') }}<input v-model="draft.location" maxlength="200"></label>
        <label>{{ t('calendars.notes') }}<textarea v-model="draft.notes" maxlength="2000" rows="3" /></label>
      </div>
      <p v-if="(dirty || attempted) && !valid" role="status" class="calendar-error">{{ t('calendars.formInvalid') }}</p>
      <p v-if="error" role="alert" class="calendar-error">{{ t(error) }}</p>
      <Button type="submit" block :disabled="!planner.writable || saving">{{ t('calendars.saveEvent') }}</Button>
    </form>
  </Sheet>
</template>
<style scoped src="./calendars.css"></style>
<style scoped>
.time-range { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-3); }
.time-range input { font-variant-numeric: tabular-nums; }
.more-toggle { display: inline-flex; align-items: center; align-self: start; justify-self: start; gap: var(--space-1); min-height: var(--tap-target); padding: 0; border: 0; background: transparent; color: var(--tint-label); font-weight: 600; }
.more-fields { display: grid; gap: var(--space-3); }
</style>
