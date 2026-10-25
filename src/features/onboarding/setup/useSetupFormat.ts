import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { DayIndex } from '@/core/model'
import { usePlannerStore } from '@/stores/plannerStore'
import { clockFormat, displayLocale, formatDuration, formatMinuteOfDay } from '@/ui/format'
import { daysPhrase, timeRangeText } from '../routineText'
import type { CategoryDraft, RangeDraft, Slot } from '../setupModel'

// How the setup writes times, days and amounts: always from Intl with the person's own language and clock.
export function useSetupFormat() {
  const { t } = useI18n()
  const planner = usePlannerStore()
  const locale = computed(() => displayLocale.value)
  const weekStartsOn = computed(() => planner.document?.settings.weekStartsOn ?? 1)
  const uses12h = computed(() => clockFormat(locale.value, { hour: 'numeric' }).resolvedOptions().hour12 === true)

  const time = (minute: number) => formatMinuteOfDay(minute, locale.value)
  const duration = (minutes: number) => formatDuration(minutes)
  const labels = () => ({ weekdays: t('onboarding.guided.days.weekdays'), everyDay: t('onboarding.guided.days.everyDay'), weekend: t('onboarding.guided.days.weekend'), everyNight: t('onboarding.guided.days.everyNight') })
  const days = (list: readonly DayIndex[], nights = false, form: 'long' | 'short' = 'long') => daysPhrase(list, locale.value, weekStartsOn.value, labels(), nights, form)
  const rangeDays = (category: CategoryDraft, range: RangeDraft, form: 'long' | 'short' = 'long') => (range.days.length === 0 ? '—' : days(range.days, category.topic === 'sleep', form))
  const rangeLine = (category: CategoryDraft, range: RangeDraft) => `${rangeDays(category, range)} · ${timeRangeText(range.start, range.end, locale.value)}`
  const slotLine = (slot: Slot) => `${days(slot.days)} · ${timeRangeText(slot.start, slot.end, locale.value)}`

  return { t, locale, weekStartsOn, uses12h, time, duration, days, rangeDays, rangeLine, slotLine }
}
