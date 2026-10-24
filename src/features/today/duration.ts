type Translate = (key: string, params?: Record<string, unknown>) => string

// "45 min", "2 h", "1 h 30 min" from whole minutes, rounded up so a countdown never shows 0.
export function formatSpan(t: Translate, minutes: number): string {
  const total = Math.max(1, Math.ceil(minutes))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return t('today.duration.minutes', { minutes: rest })
  return rest === 0 ? t('today.duration.hours', { hours }) : t('today.duration.hoursMinutes', { hours, minutes: rest })
}
