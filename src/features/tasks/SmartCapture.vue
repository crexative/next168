<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { normalizeCaptureText, parseCapture, type CaptureSpan } from '@/core/capture'
import { MAX_FIXED_MIN, MAX_TASK_MIN, MIN_TASK_MIN } from '@/core/model'
import { localDateOf } from '@/core/time'
import { usePlannerStore } from '@/stores/plannerStore'
import { announce } from '@/ui/announcer'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { addLocalDays } from '@/core/time'
import { formatDate, formatDuration, formatMinuteOfDay, displayLocale } from '@/ui/format'
import { useUndoToast } from '@/ui/undoToast'
import { useNow } from '@/features/week/useNow'
import { useCaptureSubmission } from './captureSubmission'
import { readLastTaskCategory, rememberTaskCategory } from './lastCategory'
import { undoCapture, type CaptureBinding, type CapturedTask } from './personActions'
import { ANY_FREE_TIME, clockText, minuteOf, newDraft, plannerToday, resolveWhen, taskFields, type TaskDraft } from './taskDraft'
import TaskOptions from './TaskOptions.vue'
import './registerIcons'

// The one capture box (tasks design rev 3 §2, rev 6 §2.1, addendum 6.1 F6). One line: Enter adds one task, with the
// dates, times and lengths the closed L0 grammar is sure of shown as chips the person can change (✎) or give back to
// the title (✕). Two or more lines (a paste, Shift+Enter or dictation with line breaks): nothing is inferred; the
// preview offers one task per line, titles only, or the whole text as one task. No model is involved.
const props = withDefaults(defineProps<{ dueToday?: boolean; label?: string }>(), { dueToday: false, label: undefined })
const emit = defineEmits<{ added: [count: number] }>()

const MAX_LINES = 20
const MAX_TITLE = 120

const { t, locale } = useI18n()
const planner = usePlannerStore()
const now = useNow()
const toast = useUndoToast()
const submission = useCaptureSubmission()
const ids = { field: useId(), hint: useId(), chips: useId(), preview: useId(), status: useId() }

const text = ref('')
const composing = ref(false)
const field = ref<HTMLTextAreaElement | null>(null)
// Choices made with a control (they win over anything typed), and which of them the person actually touched.
const form = ref<TaskDraft>(freshForm())
const durationTouched = ref(false)
// Keys of chips given back to the title, and values the person changed with ✎, by chip key.
const suppressed = ref<string[]>([])
const chipValues = ref<Record<string, string | number>>({})
const editing = ref<CaptureSpan | null>(null)
const chipButtons = new Map<string, HTMLButtonElement>()
// The workspace the person started typing in: what they typed never lands in another one (a delete-all, an import).
let typedIn: string | undefined

function freshForm(): TaskDraft {
  return newDraft()
}

const timeZone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
const today = computed(() => localDateOf(now.value, timeZone.value))
const categories = computed(() => planner.document?.categories ?? [])
const suggestedCategoryId = ref(readLastTaskCategory())

const lines = computed(() => normalizeCaptureText(text.value))
const multiLine = computed(() => lines.value.length >= 2)
const tooManyLines = computed(() => lines.value.length > MAX_LINES)

const manual = computed(() => ({ date: form.value.dueToday || form.value.dueDate !== '', time: form.value.at !== '', duration: durationTouched.value }))
const parsed = computed(() => {
  if (multiLine.value || !lines.value[0]) return { title: lines.value[0] ?? '', fields: {}, spans: [] as CaptureSpan[] }
  return parseCapture({ text: lines.value[0], locale: locale.value, now: now.value, timeZone: timeZone.value, manual: manual.value, suppressed: suppressed.value })
})
const spans = computed(() => parsed.value.spans)

function chipValue(span: CaptureSpan): string | number {
  return chipValues.value[span.key] ?? span.value
}

// What the task will be: controls first, then chips (as changed with ✎).
const effective = computed<TaskDraft>(() => {
  const draft: TaskDraft = { ...form.value, title: parsed.value.title }
  for (const span of spans.value) {
    const value = chipValue(span)
    if (span.field === 'date') draft.dueDate = String(value)
    if (span.field === 'time') draft.at = clockText(Number(value))
    if (span.field === 'duration') draft.durationMin = Number(value)
  }
  if (!manual.value.date && draft.dueDate === '' && parsed.value.fields.dueDate) draft.dueDate = parsed.value.fields.dueDate
  // Today's add row: a task with no date of its own is due today (a typed «mañana» still wins).
  if (props.dueToday && !draft.dueToday && draft.dueDate === '') draft.dueToday = true
  return draft
})

const detailsOpen = computed(() => !multiLine.value && text.value.trim().length > 0)
const shownDraft = computed<TaskDraft>(() => ({ ...effective.value, categoryId: resolveWhen(categories.value, effective.value.categoryId) }))
const busy = computed(() => ['saving', 'checking', 'unverified'].includes(submission.state.value))
const canAdd = computed(() => planner.writable && !busy.value && !multiLine.value && parsed.value.title.trim().length > 0)

// ---------- chips ----------

function dayName(date: string): string {
  if (date === today.value) return t('tasks.today')
  if (date === addLocalDays(today.value, 1)) return t('capture.chip.tomorrow')
  return formatDate(date, locale.value, { weekday: 'short', day: 'numeric', month: 'short' })
}

function chipLabel(span: CaptureSpan): string {
  const value = chipValue(span)
  if (span.field === 'date') return dayName(String(value))
  if (span.field === 'duration') return formatDuration(Number(value))
  const clock = formatMinuteOfDay(Number(value), displayLocale.value)
  // A time with no date chip says which day it resolved to.
  return parsed.value.fields.dateFromTime && effective.value.dueDate ? t('capture.chip.dayAndTime', { day: dayName(effective.value.dueDate), time: clock }) : clock
}

function fieldName(span: CaptureSpan): string {
  return t(`capture.field.${span.field}`)
}

function removeChip(span: CaptureSpan): void {
  suppressed.value = [...suppressed.value, span.key]
  delete chipValues.value[span.key]
  editing.value = null
  announce(t('capture.chip.removed', { text: span.text }))
  void nextTick(() => field.value?.focus())
}

function editChip(span: CaptureSpan): void {
  editing.value = editing.value?.key === span.key ? null : span
}

function closeEditor(span: CaptureSpan): void {
  editing.value = null
  void nextTick(() => chipButtons.get(span.key)?.focus())
}

function changeChip(span: CaptureSpan, event: Event): void {
  const raw = (event.target as HTMLInputElement).value
  if (span.field === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(raw)) chipValues.value = { ...chipValues.value, [span.key]: raw }
  if (span.field === 'time' && minuteOf(raw) !== undefined) chipValues.value = { ...chipValues.value, [span.key]: minuteOf(raw)! }
  if (span.field === 'duration' && raw !== '') {
    const limit = effective.value.at !== '' ? MAX_FIXED_MIN : MAX_TASK_MIN
    const minutes = Math.min(limit, Math.max(MIN_TASK_MIN, Math.round(Number(raw) / 5) * 5))
    if (Number.isFinite(minutes)) chipValues.value = { ...chipValues.value, [span.key]: minutes }
  }
}

function chipRef(key: string) {
  return (element: unknown) => { if (element instanceof HTMLButtonElement) chipButtons.set(key, element) }
}

// A suppressed phrase counts only while the text still holds it; editing it away clears the suppression.
watch(lines, (next) => {
  typedIn = next.length === 0 ? undefined : typedIn ?? planner.document?.workspaceId
  const line = (next.length === 1 ? next[0] ?? '' : '').toLowerCase().normalize('NFC')
  suppressed.value = suppressed.value.filter((key) => line.includes(key))
  if (['changed', 'notSaved', 'invalid'].includes(submission.state.value)) submission.reset()
})

// ---------- controls ----------

function patch(change: Partial<TaskDraft>): void {
  const next = { ...form.value }
  if ('durationMin' in change) { next.durationMin = change.durationMin; durationTouched.value = true }
  if ('dueDate' in change || 'dueToday' in change) {
    next.dueDate = change.dueDate ?? next.dueDate
    next.dueToday = change.dueToday ?? next.dueToday
    // "Today" switched off while the date came from a chip: that chip goes back to the title too.
    if (next.dueDate === '' && !next.dueToday) for (const span of spans.value) if (span.field === 'date') suppressed.value = [...suppressed.value, span.key]
  }
  for (const key of ['at', 'notes', 'categoryId', 'priority', 'title'] as const) if (key in change) (next as Record<string, unknown>)[key] = change[key]
  form.value = next
}

// ---------- submit ----------

function rowOf(draft: TaskDraft): CapturedTask {
  const fields = taskFields({ ...draft, categoryId: resolveWhen(categories.value, draft.categoryId) }, plannerToday(timeZone.value))
  return fields
}

function resetBox(): void {
  text.value = ''
  form.value = freshForm()
  durationTouched.value = false
  suppressed.value = []
  chipValues.value = {}
  editing.value = null
  previewBinding.value = null
}

// The text was typed in another workspace than the one shown now: refused once, with the reason, then it may be added.
function typedElsewhere(): boolean {
  const current = planner.document?.workspaceId
  if (typedIn === undefined || typedIn === current) return false
  typedIn = current
  submission.state.value = 'changed'
  return true
}

async function addOne(): Promise<void> {
  if (!canAdd.value || typedElsewhere()) return
  const row = rowOf(effective.value)
  const categoryId = row.categoryId
  const receipt = await submission.submit([row], await submission.bind())
  if (!receipt) return
  if (categoryId && categoryId !== ANY_FREE_TIME) {
    rememberTaskCategory(categoryId)
    suggestedCategoryId.value = categoryId
  }
  announce(t('capture.addedOne', { title: row.title }))
  resetBox()
  emit('added', 1)
}

// Enter: never while composing (IME); a row editor confirms only itself; two or more lines never submit; one line saves.
function onKeydown(event: KeyboardEvent): void {
  if (event.key !== 'Enter') return
  if (event.isComposing || composing.value || event.keyCode === 229) return
  if (event.shiftKey) return
  if (multiLine.value) return
  event.preventDefault()
  void addOne()
}

// ---------- multi-line preview ----------

interface PreviewRow { line: string; title: string; checked: boolean }
const rows = ref<PreviewRow[]>([])
const previewBinding = ref<CaptureBinding | null>(null)

const tooLong = (title: string) => [...title.trim()].length > MAX_TITLE
const keepOne = computed(() => lines.value.join('; '))
const keepOneTooLong = computed(() => [...keepOne.value].length > MAX_TITLE)
const chosen = computed(() => rows.value.filter((row) => row.checked && row.title.trim() !== '' && !tooLong(row.title)))

// The preview is built for these lines and this planner; a new paste or a refused submission builds it again.
async function buildPreview(): Promise<void> {
  if (!multiLine.value || tooManyLines.value) { rows.value = []; previewBinding.value = null; return }
  rows.value = lines.value.map((line) => ({ line, title: line, checked: !tooLong(line) }))
  previewBinding.value = await submission.bind()
  announce(t('capture.preview.shown', { count: rows.value.length }))
}

watch(lines, (next, previous) => {
  if (next.join('\n') !== (previous ?? []).join('\n')) void buildPreview()
})

watch(() => chosen.value.length, (count, before) => {
  if (multiLine.value && before !== undefined && count !== before) announce(t('capture.preview.count', { count }))
})

async function addAll(): Promise<void> {
  if (busy.value || chosen.value.length === 0 || typedElsewhere()) return
  const receipt = await submission.submit(chosen.value.map((row) => ({ title: row.title.trim() })), previewBinding.value)
  if (submission.state.value === 'changed') {
    await buildPreview()
    return
  }
  if (!receipt) return
  const count = receipt.createdIds.length
  resetBox()
  rows.value = []
  announce(t('capture.added', { count }, count))
  toast.show({
    message: t('capture.added', { count }, count),
    onUndo: () => {
      void undoCapture(receipt).then((outcome) => {
        if (outcome !== 'undone') announce(t('capture.undoRefused'))
      })
    },
  })
  emit('added', count)
}

async function retryCheck(): Promise<void> {
  const receipt = await submission.check()
  if (receipt) {
    resetBox()
    rows.value = []
    emit('added', receipt.createdIds.length)
  }
}

function keepAsOne(): void {
  if (keepOneTooLong.value) return
  text.value = keepOne.value
  void nextTick(() => field.value?.focus())
}

function discard(): void {
  resetBox()
  rows.value = []
  void nextTick(() => field.value?.focus())
}

function onRowKeydown(event: KeyboardEvent): void {
  // Enter confirms this row's title only; saving is only through the buttons.
  if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229) event.preventDefault()
}

// The field grows with its content (a paste or dictation with line breaks), up to a few lines, then scrolls.
function grow(): void {
  const element = field.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}
watch(text, () => void nextTick(grow))

// Row titles wrap instead of being cut: each row field is as tall as its title.
function fit(element: HTMLTextAreaElement): void {
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}
function growRow(event: Event): void {
  fit(event.target as HTMLTextAreaElement)
}
const root = ref<HTMLFormElement | null>(null)
watch(rows, () => void nextTick(() => root.value?.querySelectorAll<HTMLTextAreaElement>('.row-title').forEach(fit)))

const statusText = computed(() => {
  switch (submission.state.value) {
    case 'checking': return t('capture.status.checking')
    case 'unverified': return t('capture.status.unverified')
    case 'notSaved': return t('capture.status.notSaved')
    case 'changed': return t('capture.status.changed')
    case 'invalid': return t('capture.status.invalid')
    default: return ''
  }
})

defineExpose({ focus: () => field.value?.focus() })
</script>

<template>
  <form ref="root" class="add" :aria-label="label ?? t('tasks.add.title')" novalidate @submit.prevent="multiLine ? undefined : addOne()">
    <label class="field" :for="ids.field">
      <span class="visually-hidden">{{ t('tasks.add.titleLabel') }}</span>
      <textarea
        :id="ids.field"
        ref="field"
        v-model="text"
        class="input capture-field"
        rows="1"
        autocomplete="off"
        :enterkeyhint="multiLine ? 'enter' : 'done'"
        :placeholder="t('capture.placeholder')"
        :aria-describedby="spans.length ? ids.chips : ids.hint"
        :readonly="busy"
        :aria-busy="busy || undefined"
        data-testid="capture-field"
        @keydown="onKeydown"
        @compositionstart="composing = true"
        @compositionend="composing = false"
      />
    </label>
    <p :id="ids.hint" class="visually-hidden">{{ t('capture.dictationHint') }}</p>

    <div v-if="spans.length && !multiLine" :id="ids.chips" class="chips" role="group" :aria-label="t('capture.chip.group')" data-testid="capture-chips">
      <span v-for="span in spans" :key="span.key" class="chip" :data-field="span.field" data-testid="capture-chip">
        <button
          :ref="chipRef(span.key)"
          type="button"
          class="chip-edit t-subhead"
          :aria-label="t('capture.chip.edit', { field: fieldName(span), value: chipLabel(span) })"
          :aria-expanded="editing?.key === span.key"
          data-testid="capture-chip-edit"
          @click="editChip(span)"
        >
          <span class="chip-text">{{ chipLabel(span) }}</span>
          <Icon name="pencil" :size="14" />
        </button>
        <button type="button" class="chip-remove" :aria-label="t('capture.chip.remove', { text: span.text })" data-testid="capture-chip-remove" @click="removeChip(span)">
          <Icon name="x" :size="16" />
        </button>
      </span>
    </div>
    <div v-if="editing && !multiLine" class="chip-editor" data-testid="capture-chip-editor">
      <label class="field">
        <span class="t-footnote t-secondary">{{ fieldName(editing) }}</span>
        <input
          v-if="editing.field === 'date'"
          class="input"
          type="date"
          :value="String(chipValue(editing))"
          @change="changeChip(editing, $event)"
          @keydown.enter.prevent="closeEditor(editing)"
          @keydown.escape.prevent="closeEditor(editing)"
        >
        <input
          v-else-if="editing.field === 'time'"
          class="input"
          type="time"
          step="300"
          :value="clockText(Number(chipValue(editing)))"
          @change="changeChip(editing, $event)"
          @keydown.enter.prevent="closeEditor(editing)"
          @keydown.escape.prevent="closeEditor(editing)"
        >
        <input
          v-else
          class="input"
          type="number"
          inputmode="numeric"
          :min="MIN_TASK_MIN"
          :max="effective.at !== '' ? MAX_FIXED_MIN : MAX_TASK_MIN"
          step="5"
          :value="Number(chipValue(editing))"
          @change="changeChip(editing, $event)"
          @keydown.enter.prevent="closeEditor(editing)"
          @keydown.escape.prevent="closeEditor(editing)"
        >
      </label>
      <Button variant="plain" @click="closeEditor(editing)">{{ t('common.close') }}</Button>
    </div>

    <div v-if="detailsOpen" class="details" role="group" :aria-label="t('tasks.add.details')" data-testid="task-details">
      <TaskOptions :draft="shownDraft" :categories="categories" :time-zone="timeZone" :suggested-category-id="suggestedCategoryId" standard-lengths @patch="patch" />
      <Button type="submit" block :disabled="!canAdd">
        <Icon name="plus" :size="20" /> {{ t('tasks.add.submit') }}
      </Button>
    </div>

    <section v-if="multiLine" :id="ids.preview" class="preview" :aria-label="t('capture.preview.label')" data-testid="capture-preview">
      <template v-if="!tooManyLines">
        <p class="t-headline">{{ t('capture.preview.title', { count: rows.length }, rows.length) }}</p>
        <ol class="rows">
          <li v-for="(row, index) in rows" :key="index" class="row" :class="{ 'is-off': !row.checked }" data-testid="capture-row">
            <label class="row-check" :for="`${ids.preview}-check-${index}`">
              <input
                :id="`${ids.preview}-check-${index}`"
                v-model="row.checked"
                type="checkbox"
                :disabled="busy || tooLong(row.title)"
                :aria-label="t('capture.preview.rowName', { number: index + 1, title: row.title })"
              >
            </label>
            <div class="row-body">
              <textarea
                v-model="row.title"
                class="input row-title"
                rows="1"
                :disabled="busy"
                :aria-label="t('capture.preview.rowTitle', { number: index + 1 })"
                :aria-invalid="tooLong(row.title) || undefined"
                :aria-describedby="tooLong(row.title) ? `${ids.preview}-long-${index}` : undefined"
                data-testid="capture-row-title"
                @keydown="onRowKeydown"
                @input="growRow"
              />
              <p v-if="tooLong(row.title)" :id="`${ids.preview}-long-${index}`" class="t-footnote problem">{{ t('capture.preview.lineTooLong', { max: MAX_TITLE }) }}</p>
            </div>
          </li>
        </ol>
      </template>
      <p v-else class="t-subhead">{{ t('capture.preview.tooMany', { count: lines.length, max: MAX_LINES }) }}</p>
      <div class="preview-actions">
        <Button v-if="!tooManyLines" :disabled="busy || chosen.length === 0" data-testid="capture-add-all" @click="addAll">
          {{ t('capture.preview.addAll', { count: chosen.length }, chosen.length) }}
        </Button>
        <Button v-else variant="tinted" href="#/assistant" data-testid="capture-use-ai">{{ t('capture.preview.useAi') }}</Button>
        <Button variant="tinted" :disabled="busy || keepOneTooLong" :aria-describedby="keepOneTooLong ? `${ids.preview}-one` : undefined" data-testid="capture-keep-one" @click="keepAsOne">
          {{ t('capture.preview.keepOne') }}
        </Button>
        <Button variant="plain" :disabled="busy" data-testid="capture-discard" @click="discard">{{ t('capture.preview.discard') }}</Button>
      </div>
      <p v-if="keepOneTooLong" :id="`${ids.preview}-one`" class="t-footnote problem" data-testid="capture-keep-one-too-long">{{ t('capture.preview.keepOneTooLong', { max: MAX_TITLE }) }}</p>
    </section>

    <div v-if="statusText" :id="ids.status" class="status" role="status" data-testid="capture-status">
      <p class="t-subhead">{{ statusText }}</p>
      <Button v-if="submission.state.value === 'unverified'" variant="tinted" data-testid="capture-retry" @click="retryCheck">{{ t('capture.status.retry') }}</Button>
    </div>
  </form>
</template>

<style scoped>
.add { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--card-padding-block) var(--card-padding); background: var(--surface); border-radius: var(--radius-card); }
.field { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 0; }
.capture-field {
  padding-inline: min(var(--space-3), 12px);
  min-height: var(--tap-target);
  max-height: 12em;
  resize: none;
  overflow-y: auto;
  line-height: 1.35;
  /* One line until there is more: the height follows the content (grow()). */
  padding-block: calc((var(--tap-target) - 1.35em) / 2);
}
.details { display: flex; flex-direction: column; gap: var(--space-3); }
.chips { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.chip {
  display: inline-flex;
  align-items: stretch;
  max-width: 100%;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--tint) 14%, var(--surface));
  color: var(--label);
}
.chip-edit, .chip-remove {
  display: inline-flex;
  align-items: center;
  min-height: var(--tap-target);
  border: 0;
  background: transparent;
  color: inherit;
}
.chip-edit { gap: var(--space-1); padding: 0 var(--space-1) 0 var(--space-3); font-weight: 600; min-width: 0; text-align: start; }
.chip-text { overflow-wrap: anywhere; }
.chip-edit :deep(svg) { color: var(--label-2); }
.chip-remove { justify-content: center; min-width: var(--tap-target); color: var(--label-2); }
.chip-edit:focus-visible, .chip-remove:focus-visible { outline-offset: -2px; border-radius: var(--radius-control); }
.chip-editor { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--space-2); }
.preview { display: flex; flex-direction: column; gap: var(--space-3); }
.rows { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.row { display: flex; align-items: flex-start; gap: var(--space-2); }
/* A 44 px target around a check of the usual size. */
.row-check { display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--tap-target); height: var(--tap-target); }
.row-check input { width: 22px; height: 22px; margin: 0; accent-color: var(--tint); }
.row-title { min-height: var(--tap-target); resize: none; overflow: hidden; line-height: 1.35; padding-block: calc((var(--tap-target) - 1.35em) / 2); }
.row-body { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 0; }
.row.is-off .row-title { color: var(--label-2); }
.preview-actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.problem { color: var(--danger); }
.status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); }
.status p { flex: 1 1 12em; min-width: 0; }
</style>
