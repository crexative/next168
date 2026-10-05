<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAgendaStore } from '@/stores/agendaStore'
import { useWeekStore } from '@/stores/weekStore'
import type { AgendaItem, AgendaData, MoveProposal } from '@/types/agenda'
import type { PlannerBackup } from '@/repositories/AgendaRepository'
import { decodeBackup } from '@/repositories/AgendaRepository'
import { isMovable, moveProposal, previewMoves, proposalRequest, todayInBogota, workWarnings } from '@/services/AgendaService'
import { calendarPreview, createCalendarFile } from '@/services/CalendarExportService'

const { t } = useI18n()
const store = useAgendaStore()
const week = useWeekStore()
const date = ref(todayInBogota())
const notice = ref('')
const error = ref('')
const editing = ref(false)
const checklist = ref('')
const budget = ref('')
function blank(): AgendaItem {
  return { id: crypto.randomUUID(), title: '', date: date.value, startTime: '18:00', endTime: '19:00', kind: 'task', status: 'planned', flexible: true, calendarSelected: false }
}
const form = reactive<AgendaItem>(blank())
const items = computed(() => store.data.items.filter(item => item.date === date.value).sort((a, b) => a.startTime.localeCompare(b.startTime)))
const events = computed(() => calendarPreview(store.data))
const warnings = computed(() => workWarnings(store.data))
const response = ref('')
const reviewed = ref<MoveProposal | null>(null)
const preview = ref<AgendaData | null>(null)
const backup = ref<PlannerBackup | null>(null)
const replace = ref(false)
function fail(cause: unknown) { error.value = cause instanceof Error ? cause.message : String(cause) }
function reset() { Object.keys(form).forEach(key => { if (['notes', 'checklist', 'budgetCop'].includes(key)) delete form[key as 'notes' | 'checklist' | 'budgetCop'] }); Object.assign(form, blank()); editing.value = false; checklist.value = ''; budget.value = '' }
function edit(item: AgendaItem) { reset(); Object.assign(form, item); editing.value = true; checklist.value = item.checklist?.join('\n') ?? ''; budget.value = item.budgetCop?.toString() ?? '' }
function save() {
  error.value = ''; notice.value = ''
  const item = { ...form, date: editing.value ? form.date : date.value, calendarSelected: form.kind === 'task' ? false : form.calendarSelected }
  item.checklist = checklist.value.split('\n').map(line => line.trim()).filter(Boolean)
  if (budget.value !== '') item.budgetCop = Number(budget.value)
  else delete item.budgetCop
  if (store.put(item)) { notice.value = t('agenda.saved'); date.value = item.date; reset() }
}
function instantiateRoutine() {
  error.value = ''; notice.value = ''
  const weekday = new Date(`${date.value}T12:00:00Z`).getUTCDay()
  const additions = week.getTimeBlocksForDay(weekday).map(block => ({ id: `routine-${block.id}-${date.value}`, title: block.title,
    date: date.value, startTime: block.startTime, endTime: block.endTime, kind: 'task' as const, status: 'planned' as const, flexible: true, calendarSelected: false }))
    .filter(item => !store.data.items.some(existing => existing.id === item.id))
  if (store.commit({ ...store.data, items: [...store.data.items, ...additions] })) notice.value = t('agenda.saved')
}
function download(content: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }))
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename
  document.body.append(anchor); anchor.click(); anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function exportCalendar() {
  error.value = ''; notice.value = ''
  try {
    const content = createCalendarFile(store.data)
    download(content, 'next168-selected.ics', 'text/calendar;charset=utf-8')
    if (store.markExported()) notice.value = t('agenda.prepared')
  } catch (cause) { fail(cause) }
}
function exportBackup() {
  error.value = ''
  try {
    if (store.blocked || week.storageBlocked) throw new Error('Unreadable storage: restore a valid backup; original keys are preserved.')
    const content = decodeBackup({ schemaVersion: 1, agenda: store.data, routine: { categories: week.categories, timeBlocks: week.timeBlocks } })
    download(JSON.stringify(content, null, 2), `next168-backup-${todayInBogota()}.json`, 'application/json')
  } catch (cause) { fail(cause) }
}
async function readBackup(event: Event) {
  backup.value = null; replace.value = false; error.value = ''; notice.value = ''
  try {
    const file = (event.target as HTMLInputElement).files?.[0]
    if (!file) return
    if (file.size > 5_000_000) throw new Error('Backup exceeds 5 MB')
    backup.value = decodeBackup(JSON.parse(await file.text()))
  } catch (cause) { fail(cause) }
}
async function restore() {
  if (!replace.value || !backup.value) return
  if (store.restore(backup.value)) {
    await week.loadFromStorage(); backup.value = null; replace.value = false; reviewed.value = null; preview.value = null; reset()
    notice.value = t('agenda.restored')
  }
}
function reviewProposal() {
  error.value = ''; notice.value = ''; reviewed.value = null; preview.value = null
  try {
    const proposal = JSON.parse(response.value)
    preview.value = previewMoves(store.data, proposal)
    reviewed.value = proposal
  } catch (cause) { fail(cause) }
}
function exampleProposal() {
  const item = store.data.items.find(isMovable)
  if (!item) { error.value = t('agenda.noPending'); return }
  const nextDay = new Date(`${item.date}T12:00:00Z`); nextDay.setUTCDate(nextDay.getUTCDate() + 1)
  response.value = JSON.stringify(moveProposal(store.data, { id: item.id, date: nextDay.toISOString().slice(0, 10), startTime: item.startTime, endTime: item.endTime }), null, 2)
  reviewProposal()
}
function discard() { reviewed.value = null; preview.value = null; response.value = ''; error.value = ''; notice.value = t('agenda.discarded') }
function apply() {
  if (reviewed.value && store.applyProposal(reviewed.value)) { reviewed.value = null; preview.value = null; response.value = ''; notice.value = t('agenda.saved') }
}
const changed = computed(() => preview.value?.items.filter(item => {
  const old = store.data.items.find(old => old.id === item.id)
  return old && (old.date !== item.date || old.startTime !== item.startTime || old.endTime !== item.endTime)
}) ?? [])
</script>

<template>
  <section class="agenda" aria-labelledby="agenda-title">
    <header><h2 id="agenda-title">{{ t('agenda.title') }}</h2><p>{{ t('agenda.intro') }}</p><small>{{ t('agenda.timezone') }}</small></header>
    <p v-if="store.error || error" role="alert" class="error">{{ error || store.error }}</p>
    <p v-if="notice" role="status" class="notice">{{ notice }}</p>
    <div class="controls">
      <label>{{ t('agenda.date') }} <input v-model="date" type="date" min="2000-01-01" max="2099-12-31" required /></label>
      <label>{{ t('agenda.workEnd') }} <select :value="store.data.workEnd" :disabled="store.blocked" @change="store.commit({ ...store.data, workEnd: ($event.target as HTMLSelectElement).value as '17:00' | '17:30' })"><option>17:00</option><option>17:30</option></select></label>
    </div>
    <div class="layout">
      <div class="panel">
        <h3>{{ t('agenda.nav') }} · {{ date }}</h3>
        <p v-if="!items.length">{{ t('agenda.empty') }}</p>
        <article v-for="item in items" :key="item.id" class="item">
          <div><strong>{{ item.title }}</strong><p>{{ item.startTime }}–{{ item.endTime }} · {{ t(`agenda.${item.kind}`) }} · {{ t(`agenda.${item.status}`) }}</p><p v-if="item.notes">{{ item.notes }}</p><ul v-if="item.checklist?.length"><li v-for="(entry, index) in item.checklist" :key="index">{{ entry }}</li></ul><p v-if="item.budgetCop !== undefined">{{ t('agenda.budget') }}: {{ item.budgetCop.toLocaleString() }}</p><small v-if="item.calendarSelected">{{ t('agenda.selected') }}</small></div>
          <button :disabled="store.blocked" @click="edit(item)">{{ t('agenda.edit') }}</button>
        </article>
        <button :disabled="store.blocked || week.storageBlocked || !date" @click="instantiateRoutine">{{ t('agenda.routines') }}</button><p class="hint">{{ t('agenda.routineNote') }}</p>
      </div>
      <form class="panel" @submit.prevent="save">
        <label>{{ t('agenda.titleLabel') }}<input v-model="form.title" maxlength="200" required /></label>
        <label v-if="editing">{{ t('agenda.date') }}<input v-model="form.date" type="date" min="2000-01-01" max="2099-12-31" required /></label>
        <div class="controls"><label>{{ t('agenda.start') }}<input v-model="form.startTime" type="time" required /></label><label>{{ t('agenda.end') }}<input v-model="form.endTime" type="time" required /></label></div>
        <label>{{ t('agenda.kind') }}<select v-model="form.kind"><option v-for="kind in ['task', 'meeting', 'reservation', 'reminder']" :key="kind" :value="kind">{{ t(`agenda.${kind}`) }}</option></select></label>
        <label>{{ t('agenda.status') }}<select v-model="form.status"><option v-for="status in ['planned', 'reserved', 'done', 'cancelled']" :key="status" :value="status">{{ t(`agenda.${status}`) }}</option></select></label>
        <label>{{ t('agenda.notes') }}<textarea v-model="form.notes" maxlength="2000" rows="2" /></label>
        <label>{{ t('agenda.checklist') }}<textarea v-model="checklist" rows="2" /></label>
        <label>{{ t('agenda.budget') }}<input v-model="budget" type="number" min="0" step="1" /></label>
        <p class="hint">{{ t('agenda.declared') }}</p>
        <label class="check"><input v-model="form.flexible" type="checkbox" />{{ t('agenda.flexible') }}</label>
        <label class="check"><input v-model="form.calendarSelected" type="checkbox" :disabled="form.kind === 'task'" />{{ t('agenda.selected') }}</label>
        <div class="controls"><button type="submit" :disabled="store.blocked">{{ t('agenda.save') }}</button><button v-if="editing" type="button" @click="reset">{{ t('agenda.cancel') }}</button></div>
      </form>
    </div>
    <aside v-if="warnings.length" class="warning"><p v-for="warning in warnings" :key="warning">{{ warning }}</p></aside>
    <details class="panel"><summary>{{ t('agenda.calendar') }} ({{ events.length }})</summary>
      <p>{{ t('agenda.calendarNote') }}</p><p class="hint">{{ t('agenda.duplicateNote') }}</p>
      <ul><li v-for="item in events" :key="item.id">{{ item.title }} · {{ item.date }} {{ item.startTime }}–{{ item.endTime }}<strong v-if="store.data.exports[item.id]"> · {{ t('agenda.changed') }}</strong></li></ul>
      <p v-if="!events.length">{{ t('agenda.noEvents') }}</p><button :disabled="!events.length || store.blocked" @click="exportCalendar">{{ t('agenda.downloadCalendar') }}</button>
    </details>
    <details class="panel"><summary>{{ t('agenda.ai') }}</summary>
      <p>{{ t('agenda.aiNote') }}</p><label>{{ t('agenda.request') }}<textarea :value="JSON.stringify(proposalRequest(store.data), null, 2)" readonly rows="6" /></label>
      <button @click="exampleProposal">{{ t('agenda.example') }}</button>
      <label>{{ t('agenda.response') }}<textarea id="assistant-proposal" v-model="response" rows="6" @input="reviewed = null; preview = null" /></label><button :disabled="store.blocked" @click="reviewProposal">{{ t('agenda.preview') }}</button>
      <div v-if="preview"><h3>{{ t('agenda.changed') }}</h3><ul><li v-for="item in changed" :key="item.id">{{ item.title }} → {{ item.date }} {{ item.startTime }}–{{ item.endTime }}</li></ul><p>{{ t('agenda.localOnly') }}</p><p v-for="warning in workWarnings(preview)" :key="warning" class="warning">{{ warning }}</p><button @click="apply">{{ t('agenda.apply') }}</button><button @click="discard">{{ t('agenda.discard') }}</button></div>
    </details>
    <details class="panel"><summary>{{ t('agenda.backup') }}</summary><p>{{ t('agenda.backupNote') }}</p>
      <button @click="exportBackup">{{ t('agenda.downloadBackup') }}</button><label>{{ t('agenda.restorePreview') }}<input type="file" accept=".json,application/json" @change="readBackup" /></label>
      <div v-if="backup"><p>{{ backup.agenda.items.length }} / {{ backup.routine.timeBlocks.length }} {{ t('agenda.summary') }}</p><label class="check"><input v-model="replace" type="checkbox" />{{ t('agenda.replace') }}</label><button :disabled="!replace" @click="restore">{{ t('agenda.restore') }}</button></div>
    </details>
  </section>
</template>

<style scoped>
.agenda { max-width: 1200px; margin: auto; padding: 2rem 1rem; display: grid; gap: 1.25rem; }
h2 { color: var(--next168-blue-deep); font-size: 1.8rem; } h3 { margin-bottom: 0.6rem; }
small, .hint { color: #4b5563; font-size: .85rem; } .hint { margin-top: .5rem; }
.panel { border: 1px solid #d1d5db; background: white; padding: 1.25rem; border-radius: .8rem; }
.layout { display: grid; grid-template-columns: 1.2fr 1fr; gap: 1rem; }
.controls { display: flex; gap: 1rem; flex-wrap: wrap; align-items: end; }
label { display: flex; flex-direction: column; gap: .25rem; margin-bottom: .75rem; font-weight: 500; }
input, select, textarea { border: 1px solid #9ca3af; border-radius: .4rem; padding: .6rem; font: inherit; background: white; color: #1f2937; max-width: 100%; }
textarea { width: 100%; font: .85rem monospace; } .check { flex-direction: row; align-items: center; }
button { border: 1px solid #0d9b6e; border-radius: .4rem; background: #edfdf5; color: #065f46; padding: .6rem .85rem; font: inherit; cursor: pointer; }
button:disabled { opacity: .5; cursor: default; } button:focus-visible, input:focus-visible, summary:focus-visible { outline: 3px solid #3b82f6; outline-offset: 2px; }
.item { display: flex; justify-content: space-between; align-items: center; gap: 1rem; padding: .8rem 0; border-bottom: 1px solid #e5e7eb; margin-bottom: .75rem; }
summary { cursor: pointer; font-weight: 600; } details p, details label, details button { margin-top: .75rem; } ul { padding-left: 1.5rem; }
.error { background: #fef2f2; color: #991b1b; padding: .75rem; border-radius: .5rem; } .notice { color: #065f46; background: #ecfdf5; padding: .75rem; }
.warning { color: #854d0e; background: #fefce8; padding: .75rem; border-radius: .5rem; }
@media(max-width: 768px) { .layout { grid-template-columns: 1fr; } .agenda { padding: 1rem; } h2 { font-size: 1.4rem; } .item { flex-wrap: wrap; } }
</style>
