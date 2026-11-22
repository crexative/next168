<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import './registerIcons'

// One control row (R_Semana): the labelled "Día · Semana" switch, then the previous week, "Hoy" and the next week. The
// range and the week's free hours are the page's subtitle (WeekView). Arrows are monochrome icon buttons; "Hoy" is a
// plain action.
defineProps<{ view: 'day' | 'week' }>()
const emit = defineEmits<{ previous: []; next: []; today: []; 'set-view': [view: 'day' | 'week'] }>()

const { t } = useI18n()
const views = computed(() => [
  { value: 'day' as const, label: t('week.view.day') },
  { value: 'week' as const, label: t('week.view.week') },
])
</script>

<template>
  <div class="week-nav" role="group" :aria-label="t('week.nav.label')">
    <SegmentedControl class="view-switch" :model-value="view" :options="views" :label="t('week.view.label')" data-testid="week-view" @update:model-value="emit('set-view', $event)" />
    <span class="nav-end">
      <button type="button" class="nav-button" :aria-label="t('week.nav.previous')" data-testid="week-previous" @click="emit('previous')">
        <Icon name="chevron-left" :size="24" />
      </button>
      <button type="button" class="today-button" data-testid="week-today" @click="emit('today')">{{ t('week.nav.today') }}</button>
      <button type="button" class="nav-button" :aria-label="t('week.nav.next')" data-testid="week-next" @click="emit('next')">
        <Icon name="chevron-right" :size="24" />
      </button>
    </span>
  </div>
</template>

<style scoped>
.week-nav {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: var(--control-gap);
  padding: 0 var(--page-gutter);
}
.view-switch { flex: 0 1 10rem; }
.nav-end { display: inline-flex; align-items: center; }
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
  color: var(--label-2);
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.nav-button:active { transform: scale(0.97); }
.today-button {
  flex: none;
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  padding: 0 var(--space-1);
  border: 0;
  background: transparent;
  color: var(--tint-label);
  font-size: 1.0625rem;
  font-weight: 600;
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.today-button:active { transform: scale(0.97); }
@media (prefers-reduced-motion: reduce) {
  .nav-button:active, .today-button:active { transform: none; opacity: 0.7; }
}
</style>
