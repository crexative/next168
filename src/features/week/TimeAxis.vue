<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { formatHour } from './localTime'

withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })
const { locale } = useI18n()
const hours = computed(() => Array.from({ length: 24 }, (_, hour) => ({ hour, label: formatHour(hour, locale.value) })))
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
