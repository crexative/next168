<script setup lang="ts">
import { computed, reactive, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerEvent } from '@/core/model'
import { localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Sheet from '@/ui/Sheet.vue'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import { useCalendarStore, type CalendarIntent } from './calendarStore'
import { buildEvent, draftFromEvent, minutesOf, timeOfDay, type EventDraft } from './eventDraft'
const props = defineProps<{ open: boolean; event?: PlannerEvent }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()
const { t } = useI18n(), planner = usePlannerStore(), calendars = useCalendarStore()
// Captured when the sheet opens: a save after the planner was reset or replaced writes nothing.
let intent: CalendarIntent | undefined
const moreId = useId()
const draft = reactive<EventDraft>({ title: '', date: '', time: '09:00', allDay: false, duration: 60, location: '', notes: '', attendees: '' })
const initial = ref(''), saving = ref(false), error = ref(''), attempted = ref(false), moreOpen = ref(false)
const zone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
// The end is a time of day: it follows the start (the event keeps its length), and choosing an end sets the length.
const endTime = computed({
  get: () => timeOfDay((minutesOf(draft.time) + draft.duration) % 1440),
  set: (value: string) => { draft.duration = (minutesOf(value) - minutesOf(draft.time) + 1440) % 1440 },
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
      <div v-if="!draft.allDay" class="time-range">
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
      <Button type="submit" :disabled="!planner.writable || saving">{{ t('calendars.saveEvent') }}</Button>
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
