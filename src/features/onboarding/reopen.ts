import { ref } from 'vue'
import { usePlannerStore } from '@/stores/plannerStore'
import type { AddEntry } from './setupModel'

// "Set up my week" opens the guided setup. Opening writes nothing: the flow keeps its answers in a draft and writes the
// planner once, at the end.
export const setupRequest = ref(0)

// Whether the guided setup is on screen, for the views behind it (Hoy keeps its free hours back while it is).
export const setupOpen = ref(false)

export function openSetup(): void {
  setupRequest.value += 1
}

// Adding a routine (Week "+", the empty week) or a category (Settings) after setup: the same conversation, adding only.
export const addRequest = ref<{ entry: AddEntry; count: number } | null>(null)

export function openAdd(entry: AddEntry): void {
  addRequest.value = { entry, count: (addRequest.value?.count ?? 0) + 1 }
}

// Whether an empty Today or Week offers "Set up my week": while nothing is planned and the planner can be written.
export function setupWeekOffered(planner: ReturnType<typeof usePlannerStore>): boolean {
  return planner.status === 'ready' && planner.writable && !!planner.document && planner.document.blocks.length === 0
}
