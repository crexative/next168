import { readonly, ref, watch, type WatchSource } from 'vue'

export interface UndoToastRequest {
  message: string
  onUndo: () => void
  durationMs?: number
}

// Long enough to read, reach with the keyboard and decide (WCAG 2.2.1); held while pointed at, focused or
// while the page is hidden.
export const DEFAULT_DURATION_MS = 15000

// Each reason to hold is tracked on its own: the pointer leaving must not restart the timer while focus stays.
export type UndoHold = 'pointer' | 'focus' | 'hidden'

const current = ref<{ id: number; message: string; onUndo: () => void } | null>(null)
let nextId = 0
let timer: ReturnType<typeof setTimeout> | undefined
let remainingMs = 0
let startedAt = 0
const holds = new Set<UndoHold>()

function startTimer(): void {
  clearTimeout(timer)
  startedAt = Date.now()
  timer = setTimeout(dismiss, remainingMs)
}

function dismiss(): void {
  clearTimeout(timer)
  holds.clear()
  current.value = null
}

function show(request: UndoToastRequest): void {
  nextId += 1
  current.value = { id: nextId, message: request.message, onUndo: request.onUndo }
  remainingMs = request.durationMs ?? DEFAULT_DURATION_MS
  // Holds belonged to the previous toast's element; a hidden page still holds the new one.
  const hidden = holds.has('hidden')
  holds.clear()
  if (hidden) holds.add('hidden')
  if (holds.size === 0) startTimer()
  else clearTimeout(timer)
}

function undo(): void {
  const toast = current.value
  dismiss()
  toast?.onUndo()
}

function pause(reason: UndoHold = 'pointer'): void {
  if (reason !== 'hidden' && !current.value) return
  const wasRunning = current.value !== null && holds.size === 0
  holds.add(reason)
  if (!wasRunning) return
  clearTimeout(timer)
  remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt))
}

function resume(reason: UndoHold = 'pointer'): void {
  if (!holds.delete(reason) || holds.size > 0 || !current.value) return
  startTimer()
}

export function useUndoToast() {
  return { toast: readonly(current), show, dismiss, undo, pause, resume }
}

// An undo belongs to the data it was offered for: when that changes underneath (the workspace is replaced,
// imported or deleted), the offer is withdrawn instead of undoing into the new data.
export function dismissUndoWhenChanged(source: WatchSource<unknown>): void {
  watch(source, (next, previous) => {
    if (next !== previous) dismiss()
  })
}
