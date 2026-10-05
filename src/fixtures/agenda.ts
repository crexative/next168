import type { AgendaItem } from '@/types/agenda'
export function item(overrides: Partial<AgendaItem> = {}): AgendaItem {
  return { id: 'task-1', title: 'Synthetic task', date: '2026-10-05', startTime: '18:00', endTime: '19:00', kind: 'task', status: 'planned', flexible: true, calendarSelected: false, ...overrides }
}
