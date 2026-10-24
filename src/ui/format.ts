import { computed, ref } from 'vue'
import { MINUTES_PER_DAY } from '@/core/model'
import { i18n } from '@/i18n'

// One way to write times and durations everywhere in the UI: Intl with the full BCP-47 locale (the app's
// language plus the user's region, e.g. es-CO), the 12/24 h choice carried in the locale's `hc` extension,
// and durations as "2 h 30 min".

export type HourCycle = 'auto' | 'h12' | 'h23'
export const HOUR_CYCLES: readonly HourCycle[] = ['auto', 'h12', 'h23']

const HOUR_CYCLE_KEY = 'next168-hour-cycle'

function isHourCycle(value: unknown): value is HourCycle {
  return HOUR_CYCLES.includes(value as HourCycle)
}

// The language comes from the app; the region (and with it the default 12/24 h) from the browser's own
// preferences when they name the same language.
export function resolveDisplayLocale(language: string, preferred: readonly string[], hourCycle: HourCycle): string {
  const base = preferred.find((tag) => tag.toLowerCase().split('-')[0] === language.toLowerCase()) ?? language
  const tag = hourCycle === 'auto' ? base : `${base}-u-hc-${hourCycle}`
  try {
    return Intl.getCanonicalLocales(tag)[0] ?? language
  } catch {
    return hourCycle === 'auto' ? language : `${language}-u-hc-${hourCycle}`
  }
}

function storedHourCycle(): HourCycle {
  try {
    const value = localStorage.getItem(HOUR_CYCLE_KEY)
    return isHourCycle(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

// A display preference of this device, like the language detection: not part of the planner document.
export const hourCycle = ref<HourCycle>(storedHourCycle())

export function setHourCycle(value: HourCycle): void {
  hourCycle.value = value
  try {
    if (value === 'auto') localStorage.removeItem(HOUR_CYCLE_KEY)
    else localStorage.setItem(HOUR_CYCLE_KEY, value)
  } catch {
    // The choice still applies to this session.
  }
}

function browserLanguages(): readonly string[] {
  return typeof navigator === 'undefined' ? [] : navigator.languages ?? [navigator.language]
}

export function displayLocaleFor(language: string): string {
  return resolveDisplayLocale(language, browserLanguages(), hourCycle.value)
}

export const displayLocale = computed(() => displayLocaleFor(i18n.global.locale.value))

export function formatClock(instant: number | string | Date, locale: string, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(instant))
}

// A nominal minute of the day (0 and 1440 are both midnight); UTC keeps it independent of the host zone.
export function formatMinuteOfDay(minute: number, locale: string): string {
  const normalized = ((Math.round(minute) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric', minute: '2-digit' }).format(Date.UTC(2000, 0, 1, 0, normalized))
}

export function formatHourOfDay(hour: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { timeZone: 'UTC', hour: 'numeric' }).format(Date.UTC(2000, 0, 1, ((hour % 24) + 24) % 24))
}

// Whole hours for parts of one span (past / planned / free in the week): each part is rounded along the running total,
// so the parts never disagree with the rounded whole ("36 h", never "36,3 h", and the three still add up to 168).
// This is the one rounding rule for free-time figures: the free-hours badge, Insights and the assistant use it.
export function wholeHourParts(minutes: readonly number[]): number[] {
  let before = 0
  let roundedBefore = 0
  return minutes.map((part) => {
    before += part
    const rounded = Math.round(before / 60)
    const hours = rounded - roundedBefore
    roundedBefore = rounded
    return hours
  })
}

// The number rule: hours are never shown in tenths. Summaries, totals and goal progress read in whole hours ("54"),
// short spans in "h min" (formatDuration). Any figure that is not an hour count goes through formatWholeNumber.
export function formatHours(hours: number, locale: string = displayLocale.value): string {
  return formatWholeNumber(hours, locale)
}

// A whole number in the reader's locale ("3", "1.234" or "1 234"); the one place a bare count is written.
export function formatWholeNumber(value: number, locale: string = displayLocale.value): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Math.round(value))
}

// A whole number of hours in the duration format ("0 h", "36 h"), for parts made by wholeHourParts.
export function formatWholeHours(hours: number, locale: string = displayLocale.value): string {
  const t = i18n.global.t as (key: string, named: Record<string, unknown>) => string
  return t('common.duration.hours', { hours: formatWholeNumber(hours, locale) })
}

// A total in the number rule's words: "2 h 30 min" up to 10 h, whole hours from there ("36 h"). For legends and sums.
export function formatTotal(totalMinutes: number, locale: string = displayLocale.value): string {
  const minutes = Math.abs(totalMinutes)
  return minutes < 10 * 60 ? formatDuration(minutes, locale) : formatWholeHours(Math.round(minutes / 60), locale)
}

// "2 h 30 min", "45 min", "3 h": whole minutes, the sign left to the sentence around it. For a span of time (a block,
// a task, time left); totals and goal progress are summaries and read in whole hours (formatWholeHours).
export function formatDuration(totalMinutes: number, locale: string = displayLocale.value): string {
  const rounded = Math.abs(Math.round(totalMinutes))
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  const hours = number.format(Math.floor(rounded / 60))
  const minutes = number.format(rounded % 60)
  const t = i18n.global.t as (key: string, named: Record<string, unknown>) => string
  if (rounded < 60) return t('common.duration.minutes', { minutes })
  if (rounded % 60 === 0) return t('common.duration.hours', { hours })
  return t('common.duration.both', { hours, minutes })
}
