import type { AgendaData, AgendaItem } from '@/types/agenda'
export function eventFingerprint(item: AgendaItem): string {
  return JSON.stringify([item.title, item.date, item.startTime, item.endTime, item.kind])
}
export function calendarPreview(data: AgendaData): AgendaItem[] {
  return data.items.filter(item => item.calendarSelected && item.kind !== 'task' &&
    !['done', 'cancelled'].includes(item.status) && data.exports[item.id] !== eventFingerprint(item))
}
function escapeText(text: string): string {
  return text.replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r/g, '')
}
function timestamp(date: string, time: string) {
  // Bogotá uses UTC−05:00 throughout the supported date range (2000–2099).
  return new Date(`${date}T${time}:00-05:00`).toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
}
function fold(line: string): string {
  let result = '', current = '', bytes = 0
  for (const char of line) {
    const length = new TextEncoder().encode(char).length
    if (bytes + length > 75) { result += current + '\r\n'; current = ' '; bytes = 1 }
    current += char; bytes += length
  }
  return result + current
}
export function createCalendarFile(data: AgendaData, now = new Date()): string {
  const events = calendarPreview(data)
  if (!events.length) throw new Error('No new selected events to export')
  const stamp = now.toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z'
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Next168//Selective agenda//EN', 'CALSCALE:GREGORIAN']
  for (const item of events) lines.push('BEGIN:VEVENT', `UID:${item.id}@next168.local`, `DTSTAMP:${stamp}`,
    `DTSTART:${timestamp(item.date, item.startTime)}`, `DTEND:${timestamp(item.date, item.endTime)}`,
    `SUMMARY:${escapeText(item.title)}`, 'END:VEVENT')
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
