<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerDocument } from '@/core/model'
import Icon from '@/ui/Icon.vue'
import { formatMinute } from '@/features/week/localTime'
import { justSaved } from './checkinFlash'
import { checkInCardVisible, checkInDateFor, checkInDoneToday } from './evening'
import { disableReminder, enableReminder, REMINDER_MINUTE, reminderEnabled, reminderSupported } from './reminder'
import { checkInStreak } from './streak'

const props = defineProps<{ document: PlannerDocument; now: Date }>()
const { t, locale } = useI18n()

const timeZone = computed(() => props.document.settings.timeZone)
// The day the check-in closes (until 04:00, the day before), so the streak counts last night's entry.
const today = computed(() => checkInDateFor(props.now, timeZone.value))
const done = computed(() => checkInDoneToday(props.document, props.now))
const visible = computed(() => checkInCardVisible(props.document, props.now))
const streak = computed(() => checkInStreak(props.document.checkIns, today.value))
const remindAt = computed(() => formatMinute(REMINDER_MINUTE, locale.value))

const link = ref<HTMLAnchorElement | null>(null)
const supported = ref(reminderSupported())
const reminderOn = ref(reminderEnabled())
const blocked = ref(false)

async function toggleReminder(): Promise<void> {
  if (reminderOn.value) {
    disableReminder()
    reminderOn.value = false
    return
  }
  // The permission prompt appears here, from the user's own tap, never on load.
  const outcome = await enableReminder()
  reminderOn.value = outcome === 'enabled'
  blocked.value = outcome === 'blocked'
  supported.value = reminderSupported()
}

defineExpose({ focus: () => link.value?.focus() })
</script>

<template>
  <section v-if="visible" class="checkin-card" :aria-label="t('checkin.title')" data-testid="checkin-card">
    <a ref="link" class="checkin-row" href="#/checkin">
      <Icon :name="done ? 'check' : 'moon'" :size="22" />
      <span class="checkin-text">
        <span class="t-body">{{ t('checkin.title') }}</span>
        <span v-if="!done" class="t-footnote t-secondary">{{ t('checkin.card.description') }}</span>
        <span v-else class="t-footnote t-secondary tabular" role="status" data-testid="checkin-done">
          {{ t(justSaved ? 'checkin.card.savedStreak' : 'checkin.card.doneStreak', { count: streak }) }}
        </span>
      </span>
      <Icon name="chevron-right" :size="20" class="checkin-chevron" />
    </a>
    <button
      v-if="!done && supported || reminderOn"
      type="button"
      class="remind t-subhead"
      :aria-pressed="reminderOn"
      data-testid="checkin-remind"
      @click="toggleReminder"
    >
      <Icon :name="reminderOn ? 'check' : 'bell'" :size="18" />
      {{ t('checkin.card.remind', { time: remindAt }) }}
    </button>
    <p v-if="blocked" class="t-footnote t-secondary remind-note" role="status">{{ t('checkin.card.remindBlocked') }}</p>
  </section>
</template>

<style scoped>
.checkin-card { margin: var(--space-4) var(--space-4) 0; border-radius: var(--radius-card); background: var(--surface); }
.checkin-row {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--tap-target);
  padding: var(--space-3) var(--space-4);
  border-radius: var(--radius-card);
  color: var(--label);
  text-decoration: none;
  transition: transform 0.1s var(--ease-out);
}
.checkin-row:active { transform: scale(0.97); }
.checkin-row > :first-child { color: var(--tint-label); }
.checkin-text { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.checkin-chevron { color: var(--label-3); }
.tabular { font-variant-numeric: tabular-nums; }
.remind {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  width: 100%;
  min-height: var(--tap-target);
  padding: 0 var(--space-4);
  border: 0;
  border-top: 0.5px solid var(--separator);
  border-radius: 0 0 var(--radius-card) var(--radius-card);
  background: transparent;
  color: var(--tint-label);
  text-align: start;
}
.remind[aria-pressed='true'] { font-weight: 600; }
.remind-note { margin: 0; padding: 0 var(--space-4) var(--space-3); }
@media (prefers-reduced-motion: reduce) {
  .checkin-row:active { transform: none; opacity: 0.7; }
}
</style>
