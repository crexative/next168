export const PLANNER_TIMEZONE = 'America/Bogota' as const
export type AgendaKind = 'task' | 'meeting' | 'reservation' | 'reminder'
export type AgendaStatus = 'planned' | 'reserved' | 'done' | 'cancelled'
export interface AgendaItem {
  id: string
  title: string
  date: string
  startTime: string
  endTime: string
  kind: AgendaKind
  status: AgendaStatus
  flexible: boolean
  calendarSelected: boolean
  notes?: string
  checklist?: string[]
  budgetCop?: number
}
export interface AgendaData {
  schemaVersion: 1
  revision: string
  timezone: typeof PLANNER_TIMEZONE
  workEnd: '17:00' | '17:30'
  items: AgendaItem[]
  exports: Record<string, string>
}
export interface Move {
  id: string
  date: string
  startTime: string
  endTime: string
}
export interface MoveProposal {
  schemaVersion: 1
  baseRevision: string
  moves: Move[]
}
