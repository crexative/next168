<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { COLOR_KEYS, type CalendarSource, type ColorKey, type PlannerEvent } from '@/core/model'
import { MAX_ICS_BYTES, CalendarImportError } from '@/core/icsImport'
import { addLocalDays, localDateOf } from '@/core/time'
import { googleCalendarUrl, outlookCalendarUrl } from '@/core/calendarExport'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import { useUndoToast } from '@/ui/undoToast'
import EventSheet from '@/features/calendars/EventSheet.vue'
import CalendarOverlay from '@/features/calendars/CalendarOverlay.vue'
import { calendarErrorCode, calendarServices, useCalendarStore } from '@/features/calendars/calendarStore'
import { downloadCalendar } from '@/features/calendars/downloadCalendar'
import { displayLocale } from '@/ui/format'
const { t } = useI18n(), planner = usePlannerStore(), calendars = useCalendarStore(), toast = useUndoToast()
const name = ref(''), url = ref(''), error = ref(''), sheetOpen = ref(false), editingEvent = ref<PlannerEvent>()
const rangeStart = ref('')
const zone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
const range = computed(() => {
  const start = rangeStart.value || localDateOf(new Date(), zone.value)
  return { start, end: addLocalDays(start, 7) }
})
const sources = computed(() => planner.document?.calendarSources ?? [])
const events = computed(() => planner.document?.events ?? [])
async function run(operation: () => Promise<unknown>): Promise<void> {
  error.value = ''
  try { await operation() } catch (failure) { error.value = calendarErrorCode(failure) }
}
async function importFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement, file = input.files?.[0]
  if (!file) return
  // Captured at the gesture, before the file read: a delete-all during the read refuses the import.
  const intent = calendars.captureIntent()
  await run(async () => {
    if (file.size > MAX_ICS_BYTES) throw new CalendarImportError('size')
    await calendars.importFile(file.name.replace(/\.ics$/i, '').slice(0, 80) || t('calendars.untitled'), await file.text(), intent)
  })
  input.value = ''
}
async function addUrl(): Promise<void> {
  await run(async () => { await calendars.addUrl(name.value.trim(), url.value); name.value = ''; url.value = '' })
}
function changeName(source: CalendarSource, event: Event): void {
  const input = event.target as HTMLInputElement
  const value = input.value.trim()
  if (!value) { input.value = source.name; return }
  void run(() => calendars.updateSource(source.id, { name: value }))
}
function changeColor(source: CalendarSource, event: Event): void {
  void run(() => calendars.updateSource(source.id, { colorKey: (event.target as HTMLSelectElement).value as ColorKey }))
}
function removeSource(source: CalendarSource): void {
  // Captured at the click: the undo restores only into the planner the source was removed from.
  const intent = calendars.captureIntent()
  void run(async () => {
    const text = await calendarServices().texts.get(source.id)
    await calendars.removeSource(source.id, intent)
    if (text !== undefined) toast.show({ message: t('calendars.removed'), onUndo: () => { void run(() => calendars.restoreSource(source, text, intent)) } })
  })
}
function edit(event?: PlannerEvent): void { editingEvent.value = event; sheetOpen.value = true }
function removeEvent(event: PlannerEvent): void {
  // The undo is bound to the planner the event was removed from, not to whatever is shown when it is clicked.
  const intent = calendars.captureIntent()
  void run(async () => {
    await calendars.commitWithIntent(doc => { doc.events = doc.events.filter(item => item.id !== event.id) }, intent)
    toast.show({ message: t('calendars.removed'), onUndo: () => { void run(() => calendars.commitWithIntent(doc => {
      if (!doc.events.some(item => item.id === event.id)) doc.events.push(event)
    }, intent)) } })
  })
}
function downloadUpcoming(): void {
  const today = localDateOf(new Date(), zone.value)
  downloadCalendar(events.value.filter(event => event.allDay ? event.end.slice(0, 10) > today : Date.parse(event.end) > Date.now()))
}
function syncTime(iso: string): string { return new Intl.DateTimeFormat(displayLocale.value, { dateStyle: 'medium', timeStyle: 'short', timeZone: zone.value }).format(new Date(iso)) }
</script>
<template>
  <div class="calendar-section">
    <h2 class="section-header">{{ t('calendars.heading') }}</h2>
    <p class="calendar-note">{{ t('calendars.intro') }}</p>
    <p v-if="error" role="alert" class="calendar-error">{{ t(error) }}</p>
    <label class="calendar-file">{{ t('calendars.importFile') }}<input type="file" accept=".ics,text/calendar" :disabled="!planner.writable || calendars.pending > 0" @change="importFile"></label>
    <form class="calendar-form" @submit.prevent="addUrl">
      <label>{{ t('calendars.sourceName') }}<input v-model="name" required maxlength="80" autocomplete="off"></label>
      <label>{{ t('calendars.subscriptionUrl') }}<input v-model="url" required placeholder="https://…" inputmode="url" autocomplete="off"></label>
      <Button type="submit" variant="tinted" :disabled="!planner.writable || calendars.pending > 0">{{ t('calendars.subscribe') }}</Button>
    </form>
    <p v-if="sources.length === 0" class="calendar-note">{{ t('calendars.noSources') }}</p>
    <ul class="calendar-list">
      <li v-for="source in sources" :key="source.id" class="calendar-source" data-testid="calendar-source">
        <label>{{ t('calendars.sourceName') }}<input :value="source.name" :aria-label="t('calendars.renameSource', { name: source.name })" maxlength="80" :disabled="!planner.writable || calendars.pending > 0" @change="changeName(source, $event)"></label>
        <label>{{ t('calendars.color') }}<select :value="source.colorKey" :disabled="!planner.writable || calendars.pending > 0" @change="changeColor(source, $event)"><option v-for="color in COLOR_KEYS" :key="color" :value="color">{{ t(`calendars.colors.${color}`) }}</option></select></label>
        <p v-if="source.lastSyncedAt" class="calendar-note">{{ t('calendars.lastSync', { time: syncTime(source.lastSyncedAt) }) }}</p>
        <p v-if="source.lastError" role="alert" class="calendar-error">{{ t(source.lastError) }}</p>
        <div class="calendar-actions">
          <Button v-if="source.kind === 'url'" variant="plain" :disabled="!planner.writable || calendars.pending > 0" @click="run(() => calendars.refreshSource(source.id))">{{ t('calendars.refresh') }}</Button>
          <Button variant="plain" destructive :disabled="!planner.writable || calendars.pending > 0" @click="removeSource(source)">{{ t('calendars.remove') }}</Button>
        </div>
      </li>
    </ul>
    <h3 class="t-headline">{{ t('calendars.preview') }}</h3>
    <label class="calendar-form">{{ t('calendars.rangeStart') }}<input type="date" :value="range.start" required @change="rangeStart = ($event.target as HTMLInputElement).value || range.start"></label>
    <CalendarOverlay :range="range" />
    <h3 class="t-headline">{{ t('calendars.events') }}</h3>
    <div class="calendar-actions">
      <Button :disabled="!planner.writable" @click="edit()">{{ t('calendars.newEvent') }}</Button>
      <Button variant="plain" :disabled="events.length === 0" @click="downloadUpcoming">{{ t('calendars.downloadUpcoming') }}</Button>
    </div>
    <p v-if="events.length === 0" class="calendar-note">{{ t('calendars.noEvents') }}</p>
    <ul class="calendar-list">
      <li v-for="event in events" :key="event.id" data-testid="planner-event">
        <strong>{{ event.title }}</strong><span class="calendar-note">{{ event.allDay ? `${event.start.slice(0, 10)} · ${t('calendars.allDay')}` : syncTime(event.start) }}</span>
        <div class="calendar-actions">
          <Button variant="plain" :disabled="!planner.writable" @click="edit(event)">{{ t('calendars.edit') }}</Button>
          <a :href="googleCalendarUrl(event)" target="_blank" rel="noopener noreferrer">{{ t('calendars.google') }}</a>
          <a :href="outlookCalendarUrl(event)" target="_blank" rel="noopener noreferrer">{{ t('calendars.outlook') }}</a>
          <Button variant="plain" @click="downloadCalendar([event])">{{ t('calendars.download') }}</Button>
          <Button variant="plain" destructive :disabled="!planner.writable" @click="removeEvent(event)">{{ t('calendars.remove') }}</Button>
        </div>
      </li>
    </ul>
    <EventSheet v-model:open="sheetOpen" :event="editingEvent" />
  </div>
</template>
<style scoped src="../../calendars/calendars.css"></style>
