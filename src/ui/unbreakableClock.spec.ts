import { afterEach, expect, it } from 'vitest'
import { formatClock, formatDateTime, formatDayPeriod, formatHourOfDay, formatMinuteOfDay, setHourCycle } from './format'
import { timeRangeText } from '@/features/onboarding/routineText'

afterEach(() => setHourCycle('auto'))
it.each(['es', 'en', 'de', 'fr', 'pt'])('%s keeps every space inside a clock nonbreaking', (locale) => {
  setHourCycle('h12')
  const values = [formatClock('2026-10-21T23:00:00Z', locale, 'UTC'), formatMinuteOfDay(23 * 60, locale), formatHourOfDay(23, locale), timeRangeText(23 * 60, 7 * 60, locale)]
  for (const value of values) {
    expect(value).not.toMatch(/[ \t\r\n]/)
    expect(value).toContain('\u00a0')
  }
  expect(formatDateTime('2026-10-21T23:00:00Z', locale, 'UTC')).not.toMatch(/\d:\d{2} [apAP]|[ap]\. m\./)
  expect(formatDayPeriod(23 * 60, locale)).not.toMatch(/[ \t\r\n]/)
})
