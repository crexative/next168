import type { TimelineItem } from './todayTimeline'

export interface NextUp { title: string; start: string }

// "Después" is whatever starts next: a block, or a placed task that begins before the next block does.
export function nextUp(nextBlock: NextUp | null, items: TimelineItem[], now: Date): NextUp | null {
  const task = items.find((item) => item.kind === 'task' && Date.parse(item.start) > now.getTime())
  if (!task) return nextBlock
  if (!nextBlock || Date.parse(task.start) < Date.parse(nextBlock.start)) return { title: task.title, start: task.start }
  return nextBlock
}
