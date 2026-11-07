import type { TimelineItem } from './todayTimeline'

export interface PlannedNext { title: string; start: string }

// The next block or placed task (events aside): what the assistant answers to "what is next?". Today's own
// "Después" also counts events and free time (nextUp.ts). It is whatever starts next: a block, or a placed task that begins before the next block does.
export function nextBlockOrTask(nextBlock: PlannedNext | null, items: TimelineItem[], now: Date): PlannedNext | null {
  const task = items.find((item) => item.kind === 'task' && Date.parse(item.start) > now.getTime())
  if (!task) return nextBlock
  if (!nextBlock || Date.parse(task.start) < Date.parse(nextBlock.start)) return { title: task.title, start: task.start }
  return nextBlock
}
