import { readonly, ref } from 'vue'

export interface UndoToastRequest {
  message: string
  onUndo: () => void
  durationMs?: number
}

const DEFAULT_DURATION_MS = 5000

const current = ref<{ id: number; message: string; onUndo: () => void } | null>(null)
let nextId = 0
let timer: ReturnType<typeof setTimeout> | undefined

export function useUndoToast() {
  function dismiss(): void {
    clearTimeout(timer)
    current.value = null
  }

  function show(request: UndoToastRequest): void {
    clearTimeout(timer)
    nextId += 1
    current.value = { id: nextId, message: request.message, onUndo: request.onUndo }
    timer = setTimeout(dismiss, request.durationMs ?? DEFAULT_DURATION_MS)
  }

  function undo(): void {
    const toast = current.value
    dismiss()
    toast?.onUndo()
  }

  return { toast: readonly(current), show, dismiss, undo }
}
