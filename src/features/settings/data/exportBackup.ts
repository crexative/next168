import type { PlannerDocument } from '@/core/model'
import { calendarSourceStore } from './calendarSourceHook'
import { buildExportFile } from './dataTransfer'
import { recordExport } from './exportReminder'

// Builds the export file, hands it to the browser as a download and remembers when that happened.
export async function downloadBackup(document: PlannerDocument): Promise<string> {
  const { fileName, json } = await buildExportFile(document, calendarSourceStore(), { now: () => new Date() })
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = window.document.createElement('a')
  link.href = url
  link.download = fileName
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
  recordExport(new Date())
  return fileName
}
