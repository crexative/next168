import { readonly, ref, watch, type WatchSource } from 'vue'

export interface UndoToastRequest {
  message: string
  onUndo: () => void
  durationMs?: number
}

// Long enough to read, reach with the keyboard and decide (WCAG 2.2.1); paused while pointed at or focused.
export const DEFAULT_DURATION_MS = 15000

const current = ref<{ id: number; message: string; onUndo: () => void } | null>(null)
let nextId = 0
let timer: ReturnType<typeof setTimeout> | undefined
let remainingMs = 0
let startedAt = 0
let paused = false

function startTimer(): void {
  clearTimeout(timer)
  startedAt = Date.now()
  timer = setTimeout(dismiss, remainingMs)
}

function dismiss(): void {
  clearTimeout(timer)
  paused = false
  current.value = null
}

function show(request: UndoToastRequest): void {
  nextId += 1
  current.value = { id: nextId, message: request.message, onUndo: request.onUndo }
  remainingMs = request.durationMs ?? DEFAULT_DURATION_MS
  paused = false
  startTimer()
}

function undo(): void {
  const toast = current.value
  dismiss()
  toast?.onUndo()
}

function pause(): void {
  if (!current.value || paused) return
  paused = true
  clearTimeout(timer)
  remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt))
}

function resume(): void {
  if (!current.value || !paused) return
  paused = false
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
