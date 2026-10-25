import { ref } from 'vue'
import { usePlannerStore } from '@/stores/plannerStore'

// "Set up my week" opens the guided setup. Opening writes nothing: the flow keeps its answers in a draft and writes the
// planner once, at the end.
export const setupRequest = ref(0)

// Whether the guided setup is on screen, for the views behind it (Hoy keeps its free hours back while it is).
export const setupOpen = ref(false)

export function openSetup(): void {
  setupRequest.value += 1
}

// Whether an empty Today or Week offers "Set up my week": while nothing is planned and the planner can be written.
export function setupWeekOffered(planner: ReturnType<typeof usePlannerStore>): boolean {
  return planner.status === 'ready' && planner.writable && !!planner.document && planner.document.blocks.length === 0
}
