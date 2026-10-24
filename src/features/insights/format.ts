type Translate = (key: string, named?: Record<string, unknown>) => string

export function formatDuration(t: Translate, totalMinutes: number): string {
  const rounded = Math.round(totalMinutes)
  const hours = Math.floor(rounded / 60)
  const minutes = rounded % 60
  if (hours === 0) return t('insights.duration.minutes', { minutes })
  if (minutes === 0) return t('insights.duration.hours', { hours })
  return t('insights.duration.both', { hours, minutes })
}

export function formatHoursDecimal(minutes: number): string {
  return String(Math.round((minutes / 60) * 10) / 10)
}
