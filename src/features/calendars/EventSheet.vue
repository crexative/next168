<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerEvent } from '@/core/model'
import { localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import Sheet from '@/ui/Sheet.vue'
import Button from '@/ui/Button.vue'
import { buildEvent, draftFromEvent, type EventDraft } from './eventDraft'
const props = defineProps<{ open: boolean; event?: PlannerEvent }>()
const emit = defineEmits<{ 'update:open': [boolean] }>()
const { t } = useI18n(), planner = usePlannerStore()
const draft = reactive<EventDraft>({ title: '', date: '', time: '09:00', allDay: false, duration: 60, location: '', notes: '', attendees: '' })
const initial = ref(''), saving = ref(false), error = ref(''), attempted = ref(false)
const zone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
const dirty = computed(() => JSON.stringify(draft) !== initial.value)
const valid = computed(() => { try { buildEvent(draft, props.event?.id ?? 'preview', zone.value); return true } catch { return false } })
watch(() => props.open, open => {
  if (!open) return
  Object.assign(draft, props.event ? draftFromEvent(props.event, zone.value) : { title: '', date: localDateOf(new Date(), zone.value), time: '09:00', allDay: false, duration: 60, location: '', notes: '', attendees: '' })
  initial.value = JSON.stringify(draft); error.value = ''; attempted.value = false
}, { immediate: true })
async function save(): Promise<void> {
  attempted.value = true
  if (!valid.value || saving.value) return
  saving.value = true
  try {
    const event = buildEvent(draft, props.event?.id ?? crypto.randomUUID(), zone.value)
    const result = await planner.commit(doc => {
      const index = doc.events.findIndex(item => item.id === event.id)
      if (index < 0) doc.events.push(event)
      else doc.events[index] = event
    })
    if (result.ok) emit('update:open', false)
    else error.value = 'calendars.save'
  } catch { error.value = 'calendars.formInvalid' }
  finally { saving.value = false }
}
</script>
<template>
  <Sheet :open="open" :title="t(event ? 'calendars.editEvent' : 'calendars.newEvent')" :dirty="dirty" @update:open="emit('update:open', $event)">
    <form class="calendar-form event-form" @submit.prevent="save">
      <label>{{ t('calendars.title') }}<input v-model="draft.title" required maxlength="120" autocomplete="off"></label>
      <label>{{ t('calendars.date') }}<input v-model="draft.date" type="date" required></label>
      <label class="checkbox"><input v-model="draft.allDay" type="checkbox" @change="draft.duration = draft.allDay ? 1 : 60">{{ t('calendars.allDay') }}</label>
      <label v-if="!draft.allDay">{{ t('calendars.time') }}<input v-model="draft.time" type="time" required></label>
      <label>{{ t(draft.allDay ? 'calendars.durationDays' : 'calendars.durationMinutes') }}<input v-model.number="draft.duration" type="number" min="1" :max="draft.allDay ? 366 : 10080" required></label>
      <p class="calendar-note">{{ t('calendars.timeZone', { zone }) }}</p>
      <label>{{ t('calendars.location') }}<input v-model="draft.location" maxlength="200"></label>
      <label>{{ t('calendars.notes') }}<textarea v-model="draft.notes" maxlength="2000" rows="3" /></label>
      <label>{{ t('calendars.attendees') }}<input v-model="draft.attendees" :placeholder="t('calendars.attendeesHint')" inputmode="email"></label>
      <p v-if="(dirty || attempted) && !valid" role="status" class="calendar-error">{{ t('calendars.formInvalid') }}</p>
      <p v-if="error" role="alert" class="calendar-error">{{ t(error) }}</p>
      <Button type="submit" :disabled="!planner.writable || saving">{{ t('calendars.saveEvent') }}</Button>
    </form>
  </Sheet>
</template>
<style scoped src="./calendars.css"></style>
