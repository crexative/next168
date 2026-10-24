import type { PlannerDocument } from '@/core/model'
import { localDateOf } from '@/core/time'
import { actualFor } from './actuals'
import { isAskable } from './planSince'
import type { TimelineItem } from './todayTimeline'

export interface DayProgress { done: number; total: number }

// "2 of 3 done today": blocks that start today and can be reported on, plus the tasks placed today or finished today.
export function dayProgress(document: PlannerDocument, items: TimelineItem[], today: string, since: number | undefined): DayProgress {
  const timeZone = document.settings.timeZone
  const blocks = items.flatMap((item) => item.kind === 'block' && item.occurrence.date === today && isAskable(item.start, since) ? [item.occurrence] : [])
  const openTasks = new Set(items.flatMap((item) => item.kind === 'task' ? [item.taskId] : []))
  const doneTasks = document.tasks.filter((task) => task.doneAt && localDateOf(task.doneAt, timeZone) === today && !openTasks.has(task.id))
  const doneBlocks = blocks.filter((occurrence) => actualFor(document.actuals, occurrence)?.status === 'done')
  return { done: doneBlocks.length + doneTasks.length, total: blocks.length + openTasks.size + doneTasks.length }
}
