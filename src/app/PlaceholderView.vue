<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import EmptyState from '@/ui/EmptyState.vue'
import { usePlannerStore } from '@/stores/plannerStore'

const props = defineProps<{ view: 'today' | 'week' | 'tasks' | 'insights' }>()

const ICONS = { today: 'sun', week: 'calendar-days', tasks: 'list-checks', insights: 'chart-no-axes-column' } as const

const { t } = useI18n()
const planner = usePlannerStore()

const blockCount = computed(() => planner.document?.blocks.length ?? 0)
const description = computed(() => t(`app.placeholders.${props.view}.description`))
</script>

<template>
  <EmptyState :icon="ICONS[view]" :title="t(`app.placeholders.${view}.title`)" :description="description">
    <p v-if="view === 'week' && planner.document" class="t-headline" data-testid="block-count" :data-count="blockCount">
      {{ t('app.placeholders.week.blocks', { count: blockCount }, blockCount) }}
    </p>
  </EmptyState>
</template>
