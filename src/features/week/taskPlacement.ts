import { ref, shallowRef, watch } from 'vue'
import type { PlannerDocument, TaskPlacement } from '@/core/model'
import { fitTasks, movedOnFromToday, type MovedTask } from '@/core/scheduling'
import { localDateOf } from '@/core/time'

// What Week showed last, per workspace, so a task keeps its time while it is still valid. It lives for the
// session (it is a view concern, not part of the document) and outlives the view, so leaving Week and coming
// back does not shuffle the day either.
const shown = new Map<string, Map<string, TaskPlacement>>()
const pinned = new Map<string, Map<string, TaskPlacement>>()

export function resetPlacementMemory(): void {
  shown.clear()
  pinned.clear()
}

function forWorkspace(store: Map<string, Map<string, TaskPlacement>>, workspaceId: string): Map<string, TaskPlacement> {
  let entry = store.get(workspaceId)
  if (!entry) store.set(workspaceId, entry = new Map())
  return entry
}

export interface PlacementSource {
  document: PlannerDocument
  busy: { start: string; end: string }[]
  now: Date
  timeZone: string
  days: number
}

export interface MovedNotice {
  moved: MovedTask[]
  titles: string[]
  workspaceId: string
  // What the tasks showed before they moved on; Undo pins it.
  previous: TaskPlacement[]
}

// Undo: the tasks stay where they were until the end of the day.
export function keepWhereTheyWere(notice: MovedNotice): void {
  const keep = forWorkspace(pinned, notice.workspaceId)
  for (const placement of notice.previous) keep.set(placement.taskId, placement)
}

export function useTaskPlacements(source: () => PlacementSource | null) {
  const placements = shallowRef<TaskPlacement[]>([])
  const notice = ref<MovedNotice | null>(null)

  function recompute(): void {
    const input = source()
    if (!input) {
      placements.value = []
      return
    }
    const workspaceId = input.document.workspaceId
    const before = forWorkspace(shown, workspaceId)
    const keep = forWorkspace(pinned, workspaceId)
    const next = fitTasks({ ...input, previous: before, pinned: keep })
    const today = localDateOf(input.now, input.timeZone)
    const moved = movedOnFromToday(before, next, today, input.timeZone)
    if (moved.length) {
      const titles = new Map(input.document.tasks.map((task) => [task.id, task.title]))
      notice.value = {
        moved, workspaceId, titles: moved.map((item) => titles.get(item.taskId) ?? ''),
        previous: moved.flatMap((item) => before.get(item.taskId) ?? []),
      }
    }
    for (const [taskId, placement] of keep) {
      const first = placement.chunks[0]
      if (!first || localDateOf(first.start, input.timeZone) !== today) keep.delete(taskId)
    }
    // Only a placed task is worth remembering; one that does not fit anywhere is recomputed every time.
    before.clear()
    for (const placement of next) if (placement.chunks.length) before.set(placement.taskId, placement)
    placements.value = next
  }

  watch(source, recompute, { immediate: true })
  return { placements, notice, recompute }
}
