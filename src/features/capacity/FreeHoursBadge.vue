<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerDocument } from '@/core/model'
import { formatHours } from '@/ui/format'
import { freeHoursWhole } from './freeHours'

// `framed` draws the badge as its own pill; a parent that groups it with other figures turns it off and supplies the surface.
const props = withDefaults(defineProps<{ document: PlannerDocument; now: Date; framed?: boolean }>(), { framed: true })
const { t } = useI18n()

const timeZone = computed(() => props.document.settings.timeZone)
const freeHours = computed(() => freeHoursWhole(props.document, props.now, timeZone.value))
</script>

<template>
  <p class="free-hours t-subhead" :class="{ 'is-framed': framed }" data-testid="free-hours">
    {{ t('capacity.badge', { hours: formatHours(freeHours), count: freeHours }) }}
  </p>
</template>

<style scoped>
.free-hours { margin: 0; font-variant-numeric: tabular-nums; text-wrap: balance; }
.free-hours.is-framed { padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--surface); }
</style>
