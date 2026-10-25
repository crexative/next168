<script setup lang="ts">
import { ref } from 'vue'
import type { DayIndex } from '@/core/model'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { addRange, removeRange, touch, type CategoryDraft, type SetupState } from '../setupModel'
import RangeCard, { type Field } from './RangeCard.vue'
import { useSetupFormat } from './useSetupFormat'

// The ranges of one category, one picker open at a time across all of them, and "Add another time".
const props = defineProps<{ state: SetupState; category: CategoryDraft; labels?: Record<string, string>; sleep?: boolean }>()
const { t } = useSetupFormat()
const open = ref<{ key: string; field: Field } | null>(null)

function change(key: string, change: { days?: DayIndex[]; start?: number; end?: number }): void {
  const range = props.category.ranges.find((candidate) => candidate.key === key)
  if (range) touch(range, change)
}

function remove(key: string): void {
  open.value = null
  removeRange(props.category, key)
}

function add(): void {
  const range = addRange(props.state, props.category)
  open.value = { key: range.key, field: 'days' }
}
</script>

<template>
  <div class="ranges">
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
    <Button variant="plain" data-testid="range-add" @click="add"><Icon name="plus" :size="20" /> {{ t('onboarding.guided.range.add') }}</Button>
  </div>
</template>

<style scoped>
.ranges { display: flex; flex-direction: column; gap: var(--space-3); align-items: stretch; }
.ranges > :deep(.ui-button) { align-self: flex-start; overflow-wrap: anywhere; hyphens: auto; }
</style>
