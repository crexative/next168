<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { addLocalDays } from '@/core/time'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { displayLocale, formatDate } from '@/ui/format'
import { coverageIncludes, type DateWindow } from '../googleCalendar'
import GoogleConnectSheet from './GoogleConnectSheet.vue'
import { useGoogleConnection } from './useGoogleConnection'

// One line on Week and Today wherever the days on screen, or the days tasks are fitted over, are not covered by
// Google Calendar data in this tab: scheduling cannot avoid meetings it has not seen, and the page says so.
const props = defineProps<{ ranges: DateWindow[] }>()
const { t } = useI18n()
const google = useGoogleConnection()
const sheetOpen = ref(false)
const k = (key: string) => `calendars.googleConnection.${key}`

const state = computed<'notLoaded' | 'expired' | 'partial' | null>(() => {
  if (google.session === 'disconnected') return null
  if (!google.coverage) return 'notLoaded'
  if (google.expired) return 'expired'
  return props.ranges.every((range) => coverageIncludes(google.coverage, range)) ? null : 'partial'
})
const text = computed(() => {
  if (state.value === 'partial' && google.coverage) {
    const date = (value: string) => formatDate(value, displayLocale.value, { day: 'numeric', month: 'short' })
    return t(k('loadedRange'), { start: date(google.coverage.start), end: date(addLocalDays(google.coverage.end, -1)) })
  }
  return state.value === 'expired' ? t(k('expiredLine')) : t(k('notLoaded'))
})

function update(): void {
  if (!google.update()) sheetOpen.value = true
}
</script>

<template>
  <div v-if="state" class="notice" data-testid="google-notice" :data-state="state">
    <Icon name="info" :size="18" class="notice-mark" />
    <p class="t-footnote notice-text">{{ text }}</p>
    <Button v-if="state !== 'partial'" variant="plain" :disabled="google.busy" data-testid="google-notice-update" @click="update">{{ t(k('update')) }}</Button>
    <GoogleConnectSheet v-model:open="sheetOpen" />
  </div>
</template>

<style scoped>
.notice { display: flex; align-items: center; gap: var(--space-2) var(--space-3); flex-wrap: wrap; margin: var(--space-2) var(--page-gutter); padding: var(--space-2) var(--card-padding); border-radius: var(--radius-card); background: var(--surface); }
.notice-mark { flex: none; color: var(--label-2); }
.notice-text { flex: 1 1 12rem; min-width: 0; margin: 0; color: var(--label-2); overflow-wrap: anywhere; text-wrap: pretty; }
.notice :deep(.is-plain) { padding-inline: 0; }
</style>
