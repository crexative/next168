<script setup lang="ts">
import { computed, nextTick, ref } from 'vue'
import type { DayIndex } from '@/core/model'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { withoutDoubledPeriod } from '@/ui/sentence'
import { rangeProblem, type CategoryDraft, type RangeDraft, type SetupState } from '../setupModel'
import { OWN_LENGTHS, TOPICS } from '../setupTopics'
import DayPicker from './DayPicker.vue'
import TimeChips from './TimeChips.vue'
import { useSetupFormat } from './useSetupFormat'

export type Field = 'days' | 'start' | 'end'

const props = defineProps<{
  state: SetupState
  category: CategoryDraft
  range: RangeDraft
  open: Field | null
  // Sleep names its two times "Bedtime" and "Wake-up"; every other range "Starts" and "Ends".
  startLabel?: string
  endLabel?: string
  title?: string
  // Hidden while the range is every night (sleep), which needs no question about days.
  hideDays?: boolean
}>()
const emit = defineEmits<{
  toggle: [field: Field | null]
  change: [change: { days?: DayIndex[]; start?: number; end?: number }]
  remove: []
}>()
const { t, time, rangeDays, slotLine } = useSetupFormat()
const rows = ref<Partial<Record<Field, HTMLElement>>>({})

const lengths = computed(() => (props.category.topic ? TOPICS[props.category.topic].lengths : OWN_LENGTHS))
const nextDay = computed(() => props.range.end <= props.range.start && props.range.start !== props.range.end)
const problem = computed(() => rangeProblem(props.state, props.category, props.range))
const message = computed(() => {
  const issue = problem.value
  if (!issue) return ''
  if (issue.code === 'overlap' && issue.with) {
    const other = props.state.categories.find((candidate) => candidate.key === issue.with!.categoryKey)
    return withoutDoubledPeriod(t('onboarding.guided.errors.overlap', { name: other?.name ?? '', when: slotLine(issue.with.slot) }))
  }
  return t(`onboarding.guided.errors.${issue.code}`)
})

function focusRow(field: Field): void {
  void nextTick(() => rows.value[field]?.focus())
}

function close(field: Field): void {
  emit('toggle', null)
  focusRow(field)
}

function pick(field: 'start' | 'end', minute: number): void {
  emit('change', field === 'start' ? { start: minute } : { end: minute })
  close(field)
}

// Escape closes the open picker first; only then may the sheet itself.
function onEscape(event: KeyboardEvent): void {
  if (props.open === null) return
  event.stopPropagation()
  event.preventDefault()
  close(props.open)
}
</script>

<template>
  <section class="range" :data-range="range.key" :aria-label="title" @keydown.esc="onEscape">
    <h4 v-if="title" class="title t-body">{{ title }}</h4>

    <button v-if="!hideDays" :ref="(element) => { rows.days = element as HTMLElement }" class="row t-body" type="button" data-field="days" :aria-expanded="open === 'days'" @click="emit('toggle', open === 'days' ? null : 'days')">
      <span class="label"><Icon name="calendar-days" :size="18" />{{ t('onboarding.guided.range.days') }}</span>
      <span class="end"><span class="value">{{ rangeDays(category, range) }}</span><Icon name="chevron-right" :size="18" /></span>
    </button>
    <DayPicker v-if="open === 'days'" :days="range.days" @change="emit('change', { days: $event })" @done="close('days')" />

    <button :ref="(element) => { rows.start = element as HTMLElement }" class="row t-body" type="button" data-field="start" :aria-expanded="open === 'start'" @click="emit('toggle', open === 'start' ? null : 'start')">
      <span class="label"><Icon name="clock" :size="18" />{{ startLabel ?? t('onboarding.guided.range.start') }}</span>
      <span class="end"><span class="value">{{ time(range.start) }}</span><Icon name="chevron-right" :size="18" /></span>
    </button>
    <TimeChips v-if="open === 'start'" field="start" :value="range.start" :start="range.start" :lengths="lengths" @pick="pick('start', $event)" />

    <button :ref="(element) => { rows.end = element as HTMLElement }" class="row t-body" type="button" data-field="end" :aria-expanded="open === 'end'" @click="emit('toggle', open === 'end' ? null : 'end')">
      <span class="label"><Icon name="clock" :size="18" />{{ endLabel ?? t('onboarding.guided.range.end') }}</span>
      <span class="end"><span class="value">{{ nextDay ? `${time(range.end)} ${t('onboarding.guided.range.nextDay')}` : time(range.end) }}</span><Icon name="chevron-right" :size="18" /></span>
    </button>
    <TimeChips v-if="open === 'end'" field="end" :value="range.end" :start="range.start" :lengths="lengths" @pick="pick('end', $event)" />

    <p class="message t-body" role="status" aria-live="polite" data-testid="range-message"><template v-if="message">⚠ {{ message }}</template></p>
    <Button variant="plain" data-testid="range-remove" @click="emit('remove')">{{ t('onboarding.guided.range.remove') }}</Button>
  </section>
</template>

<style scoped>
.range { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--space-3); border-radius: var(--radius-card); background: var(--surface-2); }
.title { margin: 0; font-weight: 600; }
.row {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; column-gap: var(--space-3); width: 100%; min-height: var(--tap-target); padding: var(--space-1) var(--space-3);
  border: 0; border-radius: var(--radius-control); background: var(--surface); color: var(--label); text-align: start; touch-action: manipulation;
}
/* A small leading icon says what the row holds: days or a time. */
.label { display: inline-flex; align-items: center; gap: var(--space-2); min-width: 0; color: var(--label-2); }
/* Label and value share a line while they fit; otherwise the value takes the next line, at the end. */
.end { display: inline-flex; align-items: center; gap: var(--space-1); min-width: 0; max-width: 100%; margin-inline-start: auto; }
.value { min-width: 0; text-align: end; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: break-word; }
.row[aria-expanded='true'] { box-shadow: inset 0 0 0 2px var(--tint); }
.message { margin: 0; min-height: 0; color: var(--danger-label); overflow-wrap: anywhere; }
.message:empty { display: none; }
</style>
