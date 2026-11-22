<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'
import type { DayIndex } from '@/core/model'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { addRange, categoryMinutes, removeRange, touch, type CategoryDraft, type SetupState } from '../setupModel'
import RangeCard, { type Field } from './RangeCard.vue'
import { useSetupFormat } from './useSetupFormat'

// The ranges of one category, one picker open at a time across all of them, and "Add another time".
const props = defineProps<{ state: SetupState; category: CategoryDraft; labels?: Record<string, string>; sleep?: boolean }>()
const { t, duration } = useSetupFormat()
const root = ref<HTMLElement | null>(null)
const addButton = ref<InstanceType<typeof Button> | null>(null)
// The first range opens on its start, its times ready (fewer taps: DIRECTION §4), but only while the answers under it
// ("Añadir otro horario", "Sin horario fijo") stay in view: where the open times would push them out of the dock, the
// card starts closed, one tap from them.
const first = props.category.ranges[0]
const open = ref<{ key: string; field: Field } | null>(first ? { key: first.key, field: 'start' } : null)
onMounted(() => {
  const dock = root.value?.closest<HTMLElement>('[data-testid=setup-dock]')
  if (open.value && dock && dock.scrollHeight > dock.clientHeight + 1) open.value = null
})
// The category's hours as they are set ("40 h a la semana", R_InicioHorario).
const weekHours = computed(() => t('onboarding.guided.range.weekHours', { hours: duration(categoryMinutes(props.state, props.category)) }))

function change(key: string, change: { days?: DayIndex[]; start?: number; end?: number }): void {
  const range = props.category.ranges.find((candidate) => candidate.key === key)
  if (range) touch(range, change, props.category.topic === 'sleep')
}

// The removed card took focus with it: it goes to "Añadir otro horario", which stays.
function remove(key: string): void {
  open.value = null
  removeRange(props.category, key)
  void nextTick(() => (addButton.value?.$el as HTMLElement | undefined)?.focus())
}

function add(): void {
  const range = addRange(props.state, props.category)
  open.value = { key: range.key, field: 'start' }
}
</script>

<template>
  <div ref="root" class="ranges">
    <RangeCard
      v-for="range in category.ranges"
      :key="range.key"
      :state="state"
      :category="category"
      :range="range"
      :open="open?.key === range.key ? open.field : null"
      :title="range.label && labels ? labels[range.label] : undefined"
      :start-label="sleep ? labels?.bed : undefined"
      :end-label="sleep ? labels?.wake : undefined"
      :hide-days="sleep && range.days.length === 7 && !range.label"
      @toggle="open = $event === null ? null : { key: range.key, field: $event }"
      @change="change(range.key, $event)"
      @remove="remove(range.key)"
    />
    <p v-if="!sleep" class="week-hours t-footnote" data-testid="range-week-hours">{{ weekHours }}</p>
    <!-- "Añadir otro horario" and the screen's own way out ("Sin horario fijo") share a row (R_InicioHorario). -->
    <div class="range-actions">
      <Button ref="addButton" variant="plain" data-testid="range-add" @click="add"><Icon name="plus" :size="20" /> {{ t('onboarding.guided.range.add') }}</Button>
      <slot name="actions" />
    </div>
  </div>
</template>

<style scoped>
.ranges { display: flex; flex-direction: column; gap: var(--space-3); align-items: stretch; }
.week-hours { margin: calc(var(--space-1) * -1) 0 0; padding-inline: var(--card-padding); color: var(--label-2); font-variant-numeric: tabular-nums; }
.range-actions { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2) var(--space-3); }
.range-actions > :deep(.ui-button) { overflow-wrap: anywhere; hyphens: auto; }
</style>
