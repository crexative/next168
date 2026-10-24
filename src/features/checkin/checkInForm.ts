import type { CheckIn } from '@/core/model'

export type ExerciseAnswer = NonNullable<CheckIn['exercise']> | ''
export type StressAnswer = '' | '1' | '2' | '3' | '4' | '5'

export interface CheckInFormState {
  date: string
  bedtime: string
  wake: string
  workEnd: string
  exercise: ExerciseAnswer
  stress: StressAnswer
  note: string
}

export function minuteToTime(minute: number | undefined): string {
  if (minute === undefined) return ''
  return `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`
}

export function timeToMinute(value: string): number | undefined {
  const match = /^(\d{2}):(\d{2})$/.exec(value)
  if (!match) return undefined
  const minute = Number(match[1]) * 60 + Number(match[2])
  return minute < 1440 ? minute : undefined
}

export function formFromCheckIn(date: string, checkIn: CheckIn | undefined): CheckInFormState {
  return {
    date,
    bedtime: minuteToTime(checkIn?.bedtime),
    wake: minuteToTime(checkIn?.wake),
    workEnd: minuteToTime(checkIn?.workEnd),
    exercise: checkIn?.exercise ?? '',
    stress: checkIn?.stress ? (String(checkIn.stress) as StressAnswer) : '',
    note: checkIn?.note ?? '',
  }
}

export function checkInFromForm(form: CheckInFormState): CheckIn {
  const bedtime = timeToMinute(form.bedtime)
  const wake = timeToMinute(form.wake)
  const workEnd = timeToMinute(form.workEnd)
  const note = form.note.trim()
  return {
    date: form.date,
    ...(bedtime !== undefined ? { bedtime } : {}),
    ...(wake !== undefined ? { wake } : {}),
    ...(workEnd !== undefined ? { workEnd } : {}),
    ...(form.exercise ? { exercise: form.exercise } : {}),
    ...(form.stress ? { stress: Number(form.stress) } : {}),
    ...(note ? { note } : {}),
  }
}

export function isEmptyCheckIn(checkIn: CheckIn): boolean {
  return Object.keys(checkIn).length === 1
}

export function upsertCheckIn(checkIns: CheckIn[], next: CheckIn): CheckIn[] {
  return [...checkIns.filter((checkIn) => checkIn.date !== next.date), next].sort((a, b) => (a.date < b.date ? -1 : 1))
}
