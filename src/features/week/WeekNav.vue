<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import { weekRangeLabel } from './weekNavigation'

const props = defineProps<{ dates: string[]; today: string; isCurrent: boolean }>()
const emit = defineEmits<{ previous: []; next: []; today: [] }>()

const { t, locale } = useI18n()
const range = computed(() => weekRangeLabel(props.dates, locale.value, props.today))
</script>

<template>
  <div class="week-nav" role="group" :aria-label="t('week.nav.label')">
    <button type="button" class="nav-button" :aria-label="t('week.nav.previous')" data-testid="week-previous" @click="emit('previous')">
      <Icon name="chevron-left" :size="24" />
    </button>
    <!-- Announced when the week changes, so a screen reader hears where it landed. -->
    <p class="range t-headline" data-testid="week-range" aria-live="polite">{{ range }}</p>
    <button type="button" class="nav-button" :aria-label="t('week.nav.next')" data-testid="week-next" @click="emit('next')">
      <Icon name="chevron-right" :size="24" />
    </button>
    <button type="button" class="today-button t-subhead" data-testid="week-today" :disabled="isCurrent" @click="emit('today')">{{ t('week.nav.today') }}</button>
    <!-- Slot for the free-hours badge: its component is mounted here by the insights slice. -->
    <div class="free-hours-slot" data-testid="week-free-hours-slot" />
  </div>
</template>

<style scoped>
.week-nav {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 0 var(--space-4);
}
.nav-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tint-label);
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.nav-button:active { transform: scale(0.97); }
.range { min-width: 0; margin: 0; font-variant-numeric: tabular-nums; text-align: center; white-space: nowrap; }
.today-button {
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  margin-inline-start: auto;
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--tint) 12%, transparent);
  color: var(--tint-label);
  font-weight: 600;
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.today-button:active:not(:disabled) { transform: scale(0.97); }
/* Already on this week: the button says so by looking inert, and its label still reads "Today". */
.today-button:disabled { background: transparent; color: var(--label-2); }
.free-hours-slot:empty { display: none; }
@media (prefers-reduced-motion: reduce) {
  .nav-button:active, .today-button:active:not(:disabled) { transform: none; opacity: 0.7; }
}
</style>
