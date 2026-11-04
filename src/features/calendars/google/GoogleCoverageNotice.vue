<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import { addLocalDays } from '@/core/time'
import { useNow } from '@/features/week/useNow'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { displayLocale, formatDate, formatElapsed } from '@/ui/format'
import { coverageIncludes, type DateWindow } from '../googleCalendar'
import GoogleConnectSheet from './GoogleConnectSheet.vue'
import { savedCopyIsStale, useGoogleConnection } from './useGoogleConnection'

// One line on Week and Today about the Google Calendar data behind the days on screen, or the days tasks are fitted
// over. A warning where they are not covered in this tab (scheduling cannot avoid meetings it has not seen); a calm
// "updated 3 h ago · Update" when they come from the copy saved on this device, which after a day may be out of date.
const props = defineProps<{ ranges: DateWindow[] }>()
const { t } = useI18n()
const google = useGoogleConnection()
const planner = usePlannerStore()
const now = useNow()
const sheetOpen = ref(false)
const k = (key: string) => `calendars.googleConnection.${key}`

const state = computed<'notLoaded' | 'expired' | 'partial' | 'saved' | 'stale' | null>(() => {
  if (google.session === 'disconnected') return null
  if (!google.coverage) return 'notLoaded'
  if (google.expired) return 'expired'
  const timeZone = planner.document?.settings.timeZone ?? 'UTC'
  if (!props.ranges.every((range) => coverageIncludes(google.coverage, range, timeZone))) return 'partial'
  if (!google.fromDevice) return null
  return savedCopyIsStale(google.coverage.fetchedAt, now.value) ? 'stale' : 'saved'
})
const text = computed(() => {
  const coverage = google.coverage
  if (state.value === 'partial' && coverage) {
    const date = (value: string) => formatDate(value, displayLocale.value, { day: 'numeric', month: 'short' })
    return t(k('loadedRange'), { start: date(coverage.start), end: date(addLocalDays(coverage.end, -1)) })
  }
  if ((state.value === 'saved' || state.value === 'stale') && coverage) {
    const ago = formatElapsed(coverage.fetchedAt, now.value, displayLocale.value) ?? t(k('justNow'))
    return t(k(state.value === 'saved' ? 'savedLine' : 'staleLine'), { ago })
  }
  return state.value === 'expired' ? t(k('expiredLine')) : t(k('notLoaded'))
})
// The saved copy cannot be read again without a tap: Update stays offered next to it, even where it falls short.
const offersUpdate = computed(() => state.value !== 'partial' || google.fromDevice)

function update(): void {
  if (!google.update()) sheetOpen.value = true
}
</script>

<template>
  <div v-if="state" class="notice" data-testid="google-notice" :data-state="state">
    <Icon :name="state === 'saved' ? 'calendar-days' : 'info'" :size="18" class="notice-mark" />
    <p class="t-footnote notice-text">{{ text }}</p>
    <Button v-if="offersUpdate" variant="plain" :disabled="google.busy" data-testid="google-notice-update" @click="update">{{ t(k('update')) }}</Button>
    <GoogleConnectSheet v-model:open="sheetOpen" />
  </div>
</template>

<style scoped>
.notice { display: flex; align-items: center; gap: var(--space-2) var(--space-3); flex-wrap: wrap; margin: var(--space-2) var(--page-gutter); padding: var(--space-2) var(--card-padding); border-radius: var(--radius-card); background: var(--surface); }
.notice-mark { flex: none; color: var(--label-2); }
.notice-text { flex: 1 1 12rem; min-width: 0; margin: 0; color: var(--label-2); overflow-wrap: anywhere; text-wrap: pretty; }
.notice :deep(.is-plain) { padding-inline: 0; }
</style>
