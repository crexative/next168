<script setup lang="ts">
import { computed } from 'vue'
import { displayLocale } from '@/ui/format'
import { formatHour, formatHourCompact } from './localTime'

const props = withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const hours = computed(() => Array.from({ length: 24 }, (_, hour) => ({ hour, label: props.compact ? formatHourCompact(hour, displayLocale.value) : formatHour(hour, displayLocale.value) })))
</script>

<template>
  <div class="time-axis" aria-hidden="true">
    <span v-for="{ hour, label } in hours" :key="hour" class="hour-label t-caption">{{ hour === 0 || (compact && hour % 6 !== 0) ? '' : label }}</span>
  </div>
</template>

<style scoped>
.time-axis { position: relative; height: calc(var(--hour-height) * 24); }
.hour-label {
  display: block;
  height: var(--hour-height);
  padding-inline-end: var(--space-1);
  transform: translateY(-0.5em);
  color: var(--label-2);
  font-variant-numeric: tabular-nums;
  text-align: end;
  white-space: nowrap;
}
</style>
