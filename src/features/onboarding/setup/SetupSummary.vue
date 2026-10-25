<script setup lang="ts">
import { computed, nextTick } from 'vue'
import type { PlannerDocument } from '@/core/model'
import { categoryColor } from '@/features/insights/categoryColor'
import { formatWholeHours, wholeHourParts } from '@/ui/format'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { partOf, previousScreen } from '../setupFlow'
import { addOwnToMore, clearRanges, setRemoved, statusOf, weekTotals, type Issue, type SetupState } from '../setupModel'
import { TOPICS } from '../setupTopics'
import SetupScreen from './SetupScreen.vue'
import SummaryCard from './SummaryCard.vue'
import { useSetupFormat } from './useSetupFormat'

const props = defineProps<{
  state: SetupState
  document: PlannerDocument
  first: boolean
  reviewable: boolean
  issues: Issue[]
  busy: boolean
  message: string
  showTrust: boolean
}>()
const emit = defineEmits<{ primary: []; review: []; back: []; edited: [] }>()
const expanded = defineModel<string | null>('expanded', { default: null })
const { t } = useSetupFormat()

const totals = computed(() => {
  const week = weekTotals(props.state)
  const [assigned, free] = wholeHourParts([week.covered, 10080 - week.covered])
  return { assigned: assigned!, free: free!, overlapping: week.overlapping }
})
const rows = computed(() => props.state.categories.map((category) => ({ category, status: statusOf(props.state, category) })).filter((row) => row.status !== 'inactive'))
const visibleRows = computed(() => rows.value.filter((row) => row.status === 'active' || row.category.categoryId !== undefined || row.category.removed))
const empty = computed(() => visibleRows.value.every((row) => row.status === 'removed'))
const place = computed(() => `${t('app.tabs.settings')} › ${t('settings.categoriesTitle')}`)
const hasTasks = (key: string) => {
  const id = props.state.categories.find((category) => category.key === key)?.categoryId
  return id !== undefined && props.document.tasks.some((task) => task.categoryId === id)
}
const colorOf = (key: string) => {
  const category = props.state.categories.find((candidate) => candidate.key === key)!
  const stored = props.document.categories.find((candidate) => candidate.id === category.categoryId)
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
  const { category } = addOwnToMore(props.state, '')
  clearRanges(category)
  expanded.value = category.key
  emit('edited')
  await nextTick()
  document.querySelector<HTMLInputElement>(`[data-category="${category.key}"] [data-testid="card-name"]`)?.focus()
}
</script>

<template>
  <SetupScreen
    :title="empty ? t('onboarding.summary.empty') : t('onboarding.summary.bubble')" :part="partOf('summary')" :total="5"
    :can-back="previousScreen(state) !== undefined" :primary="first ? t('onboarding.summary.start') : t('onboarding.summary.save')" :busy="busy"
    @back="emit('back')" @primary="emit('primary')"
  >
    <template #banner><slot name="banner" /></template>
    <p class="counter t-body" role="status" data-testid="week-counter">
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
          :has-tasks="hasTasks(row.category.key)" :place="place" :issues="issues" @toggle="toggle(row.category.key)" @remove="remove(row.category.key)" @edited="emit('edited')"
        />
      </template>
    </ul>
    <Button variant="plain" data-testid="summary-add" @click="addMore"><Icon name="plus" :size="20" /> {{ t('onboarding.summary.add') }}</Button>
    <Button v-if="reviewable" variant="plain" data-testid="summary-review" @click="emit('review')">{{ t('onboarding.summary.review') }}</Button>
    <p v-if="showTrust" class="trust t-body" data-testid="setup-trust">{{ t('onboarding.guided.trust') }}</p>
  </SetupScreen>
</template>

<style scoped>
.counter, .warn, .trust { margin: 0; }
.warn { color: var(--danger-label); overflow-wrap: anywhere; }
.trust { color: var(--label-2); }
.cards { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; }
.removed { list-style: none; display: flex; align-items: center; justify-content: space-between; gap: var(--space-3); min-height: var(--tap-target); padding: var(--space-1) var(--space-4); border-radius: var(--radius-card); border: 1px dashed var(--separator); }
.removed > span { min-width: 0; overflow-wrap: anywhere; }
</style>
