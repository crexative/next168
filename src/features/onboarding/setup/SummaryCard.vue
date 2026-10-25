<script setup lang="ts">
import { computed } from 'vue'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { formatWholeHours } from '@/ui/format'
import { categoryMinutes, renameDraft, type CategoryDraft, type Issue, type SetupState } from '../setupModel'
import OtherThingField from './OtherThingField.vue'
import RangeList from './RangeList.vue'
import { useSetupFormat } from './useSetupFormat'

const props = defineProps<{ state: SetupState; category: CategoryDraft; color: string; expanded: boolean; hasTasks: boolean; place: string; issues: Issue[] }>()
const emit = defineEmits<{ toggle: []; remove: []; edited: [] }>()
const { t, duration, rangeLine } = useSetupFormat()

const minutes = computed(() => categoryMinutes(props.state, props.category))
// Whole hours from ten hours up, "h min" below: a figure a child can read.
const amount = computed(() => (minutes.value >= 600 ? formatWholeHours(Math.round(minutes.value / 60)) : duration(minutes.value)))
const nameIssue = computed(() => props.issues.find((issue) => issue.categoryKey === props.category.key && (issue.code === 'nameRequired' || issue.code === 'nameDuplicate')))

function onName(name: string): void {
  renameDraft(props.category, name)
  emit('edited')
}
</script>

<template>
  <li class="card" :data-category="category.key" :class="{ 'is-open': expanded }">
    <button class="head" type="button" :aria-expanded="expanded" :data-testid="`card-${category.key}`" @click="emit('toggle')">
      <span class="dot" aria-hidden="true" :style="{ background: color }" />
      <span class="text">
        <span class="top"><span class="name t-body">{{ category.name || '…' }}</span><span class="amount t-body">{{ amount }}</span></span>
        <span v-if="category.ranges.length === 0" class="line t-body">{{ t('onboarding.summary.noTimes') }}</span>
        <span v-for="range in category.ranges" :key="range.key" class="line t-body">{{ rangeLine(category, range) }}</span>
      </span>
      <Icon name="chevron-right" :size="18" />
    </button>
    <div v-if="expanded" class="body">
      <OtherThingField :model-value="category.name" :label="t('onboarding.summary.name')" :invalid="!!nameIssue" test-id="card-name" @update:model-value="onName" />
      <p v-if="nameIssue" class="error t-body" role="alert">{{ t(`onboarding.guided.errors.${nameIssue.code}`) }}</p>
      <RangeList :state="state" :category="category" :labels="{ there: t('onboarding.guided.commuteRanges.there'), back: t('onboarding.guided.commuteRanges.back'), bed: t('onboarding.guided.sleep.bed'), wake: t('onboarding.guided.sleep.wake'), weeknights: t('onboarding.guided.sleep.weeknights'), weekend: t('onboarding.guided.sleep.weekend') }" :sleep="category.topic === 'sleep'" />
      <p v-if="hasTasks" class="note t-body" data-testid="has-tasks">{{ t('onboarding.summary.hasTasks', { place }) }}</p>
      <Button v-else variant="plain" destructive data-testid="card-remove" @click="emit('remove')">{{ t('onboarding.summary.remove', { name: category.name }) }}</Button>
      <Button variant="tinted" data-testid="card-done" @click="emit('toggle')">{{ t('onboarding.summary.done') }}</Button>
    </div>
  </li>
</template>

<style scoped>
.card { list-style: none; border-radius: var(--radius-card); background: var(--surface-2); overflow: hidden; }
.head { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: var(--tap-target); padding: var(--space-3) var(--space-4); border: 0; background: transparent; color: var(--label); text-align: start; touch-action: manipulation; }
.head:focus-visible { outline-offset: -2px; }
.dot { flex: none; width: 14px; height: 14px; border-radius: 50%; }
.text { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 0; }
.top { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; column-gap: var(--space-3); }
.name { font-weight: 600; min-width: 0; overflow-wrap: anywhere; }
.amount { flex: none; font-variant-numeric: tabular-nums; }
.line { color: var(--label-2); overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
.body { display: flex; flex-direction: column; gap: var(--space-3); align-items: stretch; padding: 0 var(--space-3) var(--space-3); }
/* Inside a card the ranges sit flat on the card's own surface: no second inset eating the width. */
.body :deep(.range) { padding-inline: 0; }
.body > :deep(.ui-button) { align-self: flex-start; }
.error { margin: 0; color: var(--danger-label); }
.note { margin: 0; color: var(--label-2); }
</style>
