import type { AgendaData } from '@/types/agenda'
import type { WeekData } from '@/types'
import { emptyAgenda, object, validateAgenda } from '@/services/AgendaService'
import { decodeWeekData } from '@/services/WeekDataCodec'

export const AGENDA_KEY = 'next168-agenda-v1'
export const ROUTINE_KEY = 'next168-data'
export interface PlannerBackup { schemaVersion: 1; agenda: AgendaData; routine: WeekData }
export function decodeBackup(input: unknown): PlannerBackup {
  const value = object(input)
  if (value.schemaVersion !== 1 || Object.keys(value).some(key => !['schemaVersion', 'agenda', 'routine'].includes(key))) throw new Error('Unsupported backup version')
  return { schemaVersion: 1, agenda: validateAgenda(value.agenda), routine: decodeWeekData(value.routine) }
}
export class AgendaRepository {
  private observed: string | null | undefined
  load(): AgendaData {
    const raw = localStorage.getItem(AGENDA_KEY)
    const result = raw === null ? emptyAgenda() : validateAgenda(JSON.parse(raw))
    this.observed = raw
    return result
  }
  save(data: AgendaData): AgendaData {
    const current = localStorage.getItem(AGENDA_KEY)
    if (this.observed === undefined || current !== this.observed) throw new Error('Agenda changed in another tab. Reload before saving.')
    const next = validateAgenda({ ...data, revision: crypto.randomUUID() })
    if (current !== null) {
      validateAgenda(JSON.parse(current))
      localStorage.setItem(`${AGENDA_KEY}-backup`, current)
    }
    const json = JSON.stringify(next)
    localStorage.setItem(AGENDA_KEY, json)
    this.observed = json
    return next
  }
  restore(backup: PlannerBackup): AgendaData {
    const valid = decodeBackup(backup)
    const previousAgenda = localStorage.getItem(AGENDA_KEY)
    const previousRoutine = localStorage.getItem(ROUTINE_KEY)
    // The owner reviews a replacement; preserve raw recovery copies, including corrupt originals.
    if (previousAgenda !== null) localStorage.setItem(`${AGENDA_KEY}-recovery`, previousAgenda)
    if (previousRoutine !== null) localStorage.setItem(`${ROUTINE_KEY}-recovery`, previousRoutine)
    const next = validateAgenda({ ...valid.agenda, revision: crypto.randomUUID() })
    try {
      localStorage.setItem(AGENDA_KEY, JSON.stringify(next))
      localStorage.setItem(ROUTINE_KEY, JSON.stringify(valid.routine))
    } catch (error) {
      try {
        if (previousAgenda === null) localStorage.removeItem(AGENDA_KEY)
        else localStorage.setItem(AGENDA_KEY, previousAgenda)
        if (previousRoutine === null) localStorage.removeItem(ROUTINE_KEY)
        else localStorage.setItem(ROUTINE_KEY, previousRoutine)
      } catch { throw new Error('Restore failed and rollback could not complete. Recovery copies are preserved; reload and inspect storage.') }
      throw error
    }
    this.observed = JSON.stringify(next)
    return next
  }
}
