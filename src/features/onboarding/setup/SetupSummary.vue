<script setup lang="ts">
import { computed, nextTick } from 'vue'
import type { PlannerDocument } from '@/core/model'
import { categoryColor } from '@/features/insights/categoryColor'
import { formatWholeHours, wholeHourParts } from '@/ui/format'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { appendFromSummary, canAppend, categoryMinutes, clearRanges, setRemoved, weekBar, weekTotals, type Issue, type SetupState } from '../setupModel'
import { addGoalOverruns } from '../setupCommit'
import { TOPICS } from '../setupTopics'
import { summaryRows } from './conversation'
import SummaryCard from './SummaryCard.vue'
import { useSetupFormat } from './useSetupFormat'

// "Your typical week": the last message of the conversation, a card that lists everything and edits it in place.
const props = defineProps<{
  state: SetupState
  document: PlannerDocument
  issues: Issue[]
  message: string
}>()
const emit = defineEmits<{ edited: [] }>()
const expanded = defineModel<string | null>('expanded', { default: null })
const { t } = useSetupFormat()

const week = computed(() => weekTotals(props.state))
const totals = computed(() => {
  const [assigned, free] = wholeHourParts([week.value.covered, 10080 - week.value.covered])
  return { assigned: assigned!, free: free!, overlapping: week.value.overlapping }
})
const visibleRows = computed(() => summaryRows(props.state))
// The 168 h bar (R_InicioResumen): each category's hours in its colour, the hours left hatched; overlapping times count
// once (weekBar), as in the line under it.
const categoryHours = computed(() => visibleRows.value
  .filter((row) => row.status !== 'removed')
  .map((row) => ({ key: row.category.key, name: row.category.name, minutes: categoryMinutes(props.state, row.category), color: colorOf(row.category.key) }))
  .filter((part) => part.minutes > 0))
const bar = computed(() => {
  const { shares, free } = weekBar(categoryHours.value, week.value)
  return { segments: categoryHours.value.map((part, index) => ({ ...part, share: shares[index]!.minutes })), free }
})
// What the bar draws, said: "Sueño 56 h, Trabajo 40 h, 72 h sin asignar".
const barLabel = computed(() => [
  ...categoryHours.value.map((part) => `${part.name} ${formatWholeHours(Math.round(part.minutes / 60))}`),
  t('onboarding.summary.unassigned', { hours: formatWholeHours(totals.value.free) }),
].join(', '))
const place = computed(() => `${t('app.tabs.settings')} › ${t('settings.categoriesTitle')}`)
const hasTasks = (key: string) => {
  const id = props.state.categories.find((category) => category.key === key)?.categoryId
  return id !== undefined && props.document.tasks.some((task) => task.categoryId === id)
}
const adding = computed(() => props.state.add !== undefined)
// Adding: each item that goes into a stored category says so, and warns when that category's "at most" goal is passed.
const overruns = computed(() => (adding.value ? addGoalOverruns(props.state, props.document) : new Map<string, number>()))
const destinationOf = (key: string) => {
  const into = props.state.categories.find((candidate) => candidate.key === key)?.into
  return into === undefined ? undefined : props.document.categories.find((candidate) => candidate.id === into)
}
// "in Work" under an item going into Work, unless the item is simply called that.
const destinationLine = (key: string) => {
  const destination = destinationOf(key)
  const title = props.state.categories.find((candidate) => candidate.key === key)?.name.trim().toLowerCase()
  return destination && destination.name.trim().toLowerCase() !== title ? t('onboarding.summary.into', { name: destination.name }) : undefined
}
const warningOf = (key: string) => {
  const destination = destinationOf(key)
  const minutes = destination ? overruns.value.get(destination.id) : undefined
  return minutes === undefined ? undefined : t('week.editor.warnings.goalOver', { category: destination!.name, hours: t('week.editor.hours', { hours: Math.round((minutes / 60) * 10) / 10 }) })
}
const colorOf = (key: string) => {
  const category = props.state.categories.find((candidate) => candidate.key === key)!
  const stored = props.document.categories.find((candidate) => candidate.id === (category.categoryId ?? category.into))
  return stored ? categoryColor(stored) : `var(--cat-${category.topic ? TOPICS[category.topic].colorKey : 'blue'})`
}

function toggle(key: string): void {
  expanded.value = expanded.value === key ? null : key
}

function remove(key: string): void {
  setRemoved(props.state, key, true)
  expanded.value = null
  emit('edited')
}

function undo(key: string): void {
  setRemoved(props.state, key, false)
  emit('edited')
}

async function addMore(): Promise<void> {
  const category = appendFromSummary(props.state, '')
  if (!category) return
  clearRanges(category)
  expanded.value = category.key
  emit('edited')
  await nextTick()
  document.querySelector<HTMLInputElement>(`[data-category="${category.key}"] [data-testid="card-name"]`)?.focus()
}
</script>

<template>
  <section class="week" data-testid="week-card" :aria-label="t(adding ? 'onboarding.summary.addTitle' : 'onboarding.summary.title')">
    <h4 class="week-title t-title-2">{{ t(adding ? 'onboarding.summary.addTitle' : 'onboarding.summary.title') }}</h4>
    <div v-if="!adding" class="bar" role="img" :aria-label="barLabel" data-testid="summary-bar">
      <i v-for="segment in bar.segments" :key="segment.key" class="segment" :data-segment="segment.key" :style="{ flexGrow: segment.share, background: segment.color }" />
      <i v-if="bar.free > 0" class="segment is-free" data-segment="free" :style="{ flexGrow: bar.free }" />
    </div>
    <p v-if="!adding" class="counter t-subhead" role="status" data-testid="week-counter">
      <strong>{{ t('onboarding.summary.assigned', { hours: formatWholeHours(totals.assigned) }) }}</strong> · {{ t('onboarding.summary.unassigned', { hours: formatWholeHours(totals.free) }) }}
    </p>
    <p v-if="totals.overlapping" class="warn t-body" data-testid="overlap-warning">⚠ {{ t('onboarding.summary.overlapping') }}</p>
    <p v-if="message" class="warn t-body" role="alert" data-testid="summary-message">{{ message }}</p>

    <ul class="cards">
      <template v-for="row in visibleRows" :key="row.category.key">
        <li v-if="row.status === 'removed'" class="removed" :data-removed="row.category.key">
          <span class="t-body" :data-testid="hasTasks(row.category.key) ? 'kept-for-tasks' : 'removed-note'">{{ hasTasks(row.category.key) ? t('onboarding.summary.keptForTasks', { name: row.category.name }) : t('onboarding.summary.removed', { name: row.category.name }) }}</span>
          <Button variant="plain" data-testid="card-undo" @click="undo(row.category.key)">{{ t('onboarding.summary.undo') }}</Button>
        </li>
        <SummaryCard
          v-else
          :state="state" :category="row.category" :color="colorOf(row.category.key)" :expanded="expanded === row.category.key"
          :has-tasks="hasTasks(row.category.key)" :place="place" :issues="issues" :destination="destinationLine(row.category.key)" :warning="warningOf(row.category.key)" @toggle="toggle(row.category.key)" @remove="remove(row.category.key)" @edited="emit('edited')"
        />
      </template>
    </ul>
    <Button v-if="canAppend(state)" variant="plain" data-testid="summary-add" @click="addMore"><Icon name="plus" :size="20" /> {{ t('onboarding.summary.add') }}</Button>
    <p v-else class="trust t-body" data-testid="summary-limit">{{ t('onboarding.guided.again.limit') }}</p>
  </section>
</template>

<style scoped>
/* The week, as the last message: a grey card with the 168 h bar and the list of what goes in it (R_InicioResumen). */
.week { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--card-padding-block) var(--card-padding); border-radius: 20px; background: var(--surface-2); }
/* On a phone the week uses the column's full width, as before: inside a second inset an open category's label and
   value would no longer share one line at 360 px. The bar and the list keep their own shapes. */
@media (max-width: 40rem) { .week { padding: 0; border-radius: 0; background: transparent; } }
.bar { display: flex; gap: 2px; height: 28px; overflow: hidden; border-radius: 8px; }
.segment { display: block; flex: 0 1 auto; flex-basis: 0; min-width: 0; }
.segment.is-free { background: repeating-linear-gradient(135deg, var(--fill) 0 4px, transparent 4px 8px); box-shadow: inset 0 0 0 1px var(--separator); }
.counter { color: var(--label-2); }
.counter strong { color: var(--label); }
.week-title, .counter, .warn, .trust { margin: 0; }
.warn { color: var(--danger-label); overflow-wrap: anywhere; }
.trust { color: var(--label-2); }
.cards { display: flex; flex-direction: column; margin: 0; padding: 0; border-radius: var(--radius-card); background: var(--surface); }
.cards > :deep(li + li) { border-top: 0.5px solid var(--separator); }
.removed { list-style: none; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--tap-target); padding: var(--space-1) var(--card-padding); color: var(--label-2); }
.removed > span { min-width: 0; overflow-wrap: anywhere; }
.week > :deep(.ui-button) { overflow-wrap: anywhere; hyphens: auto; }
</style>
