<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import { weekRangeLabel } from './weekNavigation'

// One compact toolbar: previous week, the range (with the free hours of the week under it), next week, "Today" only
// when another week is shown, and - on a phone - the one button that switches between a day and the whole week.
const props = defineProps<{ dates: string[]; today: string; isCurrent: boolean; view?: 'day' | 'week' }>()
const emit = defineEmits<{ previous: []; next: []; today: []; 'toggle-view': [] }>()

const { t, locale } = useI18n()
const range = computed(() => weekRangeLabel(props.dates, locale.value, props.today))
</script>

<template>
  <div class="week-nav" role="group" :aria-label="t('week.nav.label')">
    <button type="button" class="nav-button" :aria-label="t('week.nav.previous')" data-testid="week-previous" @click="emit('previous')">
      <Icon name="chevron-left" :size="24" />
    </button>
    <div class="heading">
      <!-- Announced when the week changes, so a screen reader hears where it landed. -->
      <p class="range t-headline" data-testid="week-range" aria-live="polite">{{ range }}</p>
      <div class="free-hours-slot" data-testid="week-free-hours-slot"><slot name="free-hours" /></div>
    </div>
    <button type="button" class="nav-button" :aria-label="t('week.nav.next')" data-testid="week-next" @click="emit('next')">
      <Icon name="chevron-right" :size="24" />
    </button>
    <button v-if="!isCurrent" type="button" class="today-button t-subhead" data-testid="week-today" @click="emit('today')">{{ t('week.nav.today') }}</button>
    <button
      v-if="view"
      type="button"
      class="nav-button view-button"
      :aria-label="t(view === 'day' ? 'week.view.showWeek' : 'week.view.showDay')"
      data-testid="week-view-toggle"
      @click="emit('toggle-view')"
    >
      <Icon :name="view === 'day' ? 'columns-3' : 'calendar-1'" :size="22" />
    </button>
  </div>
</template>

<style scoped>
.week-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--space-1);
  padding: 0 var(--space-4);
}
.nav-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: var(--tap-target);
  height: var(--tap-target);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tint-label);
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.nav-button:active { transform: scale(0.97); }
/* The range takes the room between the arrows; with large text it wraps between its words instead of spilling. */
.heading { display: flex; flex: 1 1 8rem; flex-direction: column; min-width: 0; text-align: center; }
.range { min-width: 0; margin: 0; font-variant-numeric: tabular-nums; text-wrap: balance; }
.today-button {
  flex: none;
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-control);
  background: color-mix(in srgb, var(--tint) 12%, transparent);
  color: var(--tint-label);
  font-weight: 600;
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.today-button:active { transform: scale(0.97); }
.free-hours-slot:empty { display: none; }
.free-hours-slot :deep(p) { color: var(--label-2); font-size: 0.8125rem; line-height: 1.38; }
@media (prefers-reduced-motion: reduce) {
  .nav-button:active, .today-button:active { transform: none; opacity: 0.7; }
}
</style>
