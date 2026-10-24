import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'
import { dismissUndoWhenChanged, useUndoToast } from './undoToast'

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  useUndoToast().dismiss()
  vi.useRealTimers()
})

describe('undo toast', () => {
  it('stays fifteen seconds without undoing', () => {
    const onUndo = vi.fn()
    const { show, toast } = useUndoToast()
    show({ message: 'Deleted', onUndo })
    expect(toast.value?.message).toBe('Deleted')
    vi.advanceTimersByTime(14999)
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
    vi.advanceTimersByTime(12000)
    show({ message: 'Second', onUndo: vi.fn() })
    vi.advanceTimersByTime(12000)
    expect(toast.value?.message).toBe('Second')
  })

  it('holds while pointed at or focused and resumes with the time it had left', () => {
    const { show, pause, resume, toast } = useUndoToast()
    show({ message: 'Deleted', onUndo: vi.fn() })
    vi.advanceTimersByTime(10000)
    pause()
    vi.advanceTimersByTime(60000)
    expect(toast.value).not.toBeNull()
    resume()
    vi.advanceTimersByTime(4999)
    expect(toast.value).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(toast.value).toBeNull()
  })

  it('retains undo while focus remains after the pointer leaves', () => {
    const { show, pause, resume, toast } = useUndoToast()
    show({ message: 'Deleted', onUndo: vi.fn() })
    pause('pointer')
    pause('focus')
    resume('pointer')
    vi.advanceTimersByTime(60000)
    expect(toast.value).not.toBeNull()
    resume('focus')
    vi.advanceTimersByTime(14999)
    expect(toast.value).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(toast.value).toBeNull()
  })

  it('retains undo while the pointer stays after focus leaves', () => {
    const { show, pause, resume, toast } = useUndoToast()
    show({ message: 'Deleted', onUndo: vi.fn() })
    pause('focus')
    pause('pointer')
    resume('focus')
    vi.advanceTimersByTime(60000)
    expect(toast.value).not.toBeNull()
    resume('pointer')
    vi.advanceTimersByTime(15000)
    expect(toast.value).toBeNull()
  })

  it('a repeated hold or a release without a hold does not shorten or restart the time', () => {
    const { show, pause, resume, toast } = useUndoToast()
    show({ message: 'Deleted', onUndo: vi.fn() })
    vi.advanceTimersByTime(5000)
    resume('focus')
    pause('pointer')
    pause('pointer')
    vi.advanceTimersByTime(30000)
    resume('pointer')
    vi.advanceTimersByTime(9999)
    expect(toast.value).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(toast.value).toBeNull()
  })

  it('does not run while the page is hidden, including for a toast shown while hidden', () => {
    const { show, pause, resume, toast } = useUndoToast()
    pause('hidden')
    show({ message: 'Deleted', onUndo: vi.fn() })
    vi.advanceTimersByTime(60000)
    expect(toast.value).not.toBeNull()
    resume('hidden')
    vi.advanceTimersByTime(14999)
    expect(toast.value).not.toBeNull()
    vi.advanceTimersByTime(1)
    expect(toast.value).toBeNull()
  })

  it('a hold on a dismissed toast does not carry over to the next one', () => {
    const { show, pause, dismiss, toast } = useUndoToast()
    show({ message: 'First', onUndo: vi.fn() })
    pause('focus')
    dismiss()
    show({ message: 'Second', onUndo: vi.fn() })
    vi.advanceTimersByTime(15000)
    expect(toast.value).toBeNull()
  })

  it('a newer toast shown while the old one was held starts its own full time', () => {
    const { show, pause, toast } = useUndoToast()
    show({ message: 'First', onUndo: vi.fn() })
    pause()
    show({ message: 'Second', onUndo: vi.fn() })
    vi.advanceTimersByTime(14999)
    expect(toast.value?.message).toBe('Second')
    vi.advanceTimersByTime(1)
    expect(toast.value).toBeNull()
  })

  it('is withdrawn when the data it would undo into is replaced', async () => {
    const workspace = ref('workspace-a')
    const scope = effectScope()
    scope.run(() => dismissUndoWhenChanged(workspace))
    const onUndo = vi.fn()
    const { show, undo, toast } = useUndoToast()
    show({ message: 'Deleted', onUndo })
    workspace.value = 'workspace-b'
    await nextTick()
    expect(toast.value).toBeNull()
    undo()
    expect(onUndo).not.toHaveBeenCalled()
    scope.stop()
  })
})
