<script setup lang="ts">
import { inlineSeparators } from '@/ui/inlineText'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerDocument } from '@/core/model'
import Icon from '@/ui/Icon.vue'
import { justSaved } from './checkinFlash'
import { checkInDateFor, checkInDoneToday } from './evening'
import { checkInStreak } from './streak'

const props = defineProps<{ document: PlannerDocument; now: Date }>()
const { t } = useI18n()

const timeZone = computed(() => props.document.settings.timeZone)
// The day the check-in closes (until 04:00, the day before), so the streak counts last night's entry.
const today = computed(() => checkInDateFor(props.now, timeZone.value))
const done = computed(() => checkInDoneToday(props.document, props.now))
const streak = computed(() => checkInStreak(props.document.checkIns, today.value))

const link = ref<HTMLAnchorElement | null>(null)
defineExpose({ focus: () => link.value?.focus() })
</script>

<template>
  <!-- One row, all day (R_Hoy): Today puts it at the end of the day's list, and above the list from 20:00 until it is
       done. The reminder lives at the end of the check-in conversation now. -->
  <a ref="link" class="checkin-card" href="#/checkin" data-testid="checkin-card">
    <Icon :name="done ? 'check' : 'moon'" :size="22" class="checkin-icon" />
    <span class="checkin-text">
      <span class="t-body">{{ t('checkin.title') }}</span>
      <span v-if="!done" class="t-footnote t-secondary">{{ t('checkin.card.description') }}</span>
      <span v-else class="t-footnote t-secondary tabular" role="status" data-testid="checkin-done">
        {{ inlineSeparators(t(justSaved ? 'checkin.card.savedStreak' : 'checkin.card.doneStreak', { count: streak })) }}
      </span>
    </span>
    <Icon name="chevron-right" :size="16" class="checkin-chevron" />
  </a>
</template>

<style scoped>
.checkin-card {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: 68px;
  margin: var(--section-gap) var(--page-gutter) 0;
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--surface-2);
  color: var(--label);
  text-decoration: none;
  transition: transform 0.1s var(--ease-out);
}
.checkin-card:active { transform: scale(0.98); }
.checkin-icon { color: var(--tint-label); }
.checkin-text { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.checkin-chevron { color: var(--label-3); }
.tabular { font-variant-numeric: tabular-nums; }
@media (prefers-reduced-motion: reduce) {
  .checkin-card:active { transform: none; opacity: 0.7; }
}
</style>
