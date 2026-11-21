import { formatHours } from '@/ui/format'

type Translate = (key: string, named: Record<string, unknown>, plural: number) => string

// The free hours as a sentence ("26 h libres esta semana"): one way to put the number into words, for the badge on Hoy
// and Semana and the headline of Resumen.
export function freeHoursText(t: Translate, key: string, hours: number): string {
  return t(key, { hours: formatHours(hours), count: hours }, hours)
}
