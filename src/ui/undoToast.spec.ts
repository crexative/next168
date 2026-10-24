import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUndoToast } from './undoToast'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  useUndoToast().dismiss()
  vi.useRealTimers()
})

describe('undo toast', () => {
  it('disappears after five seconds without undoing', () => {
    const onUndo = vi.fn()
    const { show, toast } = useUndoToast()
    show({ message: 'Deleted', onUndo })
    expect(toast.value?.message).toBe('Deleted')
    vi.advanceTimersByTime(4999)
    expect(toast.value).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(toast.value).toBeNull()
    expect(onUndo).not.toHaveBeenCalled()
  })

  it('undo runs the callback once and closes the toast', () => {
    const onUndo = vi.fn()
    const { show, undo, toast } = useUndoToast()
    show({ message: 'Deleted', onUndo })
    undo()
    undo()
    expect(onUndo).toHaveBeenCalledOnce()
    expect(toast.value).toBeNull()
  })

  it('a newer toast replaces the older one and restarts the timer', () => {
    const { show, toast } = useUndoToast()
    show({ message: 'First', onUndo: vi.fn() })
    vi.advanceTimersByTime(4000)
    show({ message: 'Second', onUndo: vi.fn() })
    vi.advanceTimersByTime(4000)
    expect(toast.value?.message).toBe('Second')
  })
})
