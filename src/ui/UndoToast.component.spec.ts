import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import UndoToast from './UndoToast.vue'
import { openFullScreen } from './sheetStack'
import { useUndoToast } from './undoToast'

let app: ReturnType<typeof createApp> | undefined

beforeEach(async () => {
  vi.useFakeTimers()
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp(UndoToast)
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en: { common: { undo: 'Undo' } } } })).mount(root)
  useUndoToast().show({ message: 'Deleted', onUndo: vi.fn() })
  await nextTick()
})

afterEach(() => {
  useUndoToast().dismiss()
  app?.unmount()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

const toastElement = () => document.querySelector<HTMLElement>('[data-testid="undo-toast"]')

describe('UndoToast under a full-screen flow (N10)', () => {
  it('keeps announcing an offer made before the flow opened, but neither its button nor Ctrl/Cmd+Z can take it', async () => {
    const onUndo = vi.fn()
    useUndoToast().dismiss()
    await vi.advanceTimersByTimeAsync(500)
    useUndoToast().show({ message: 'Routine deleted', onUndo })
    const release = openFullScreen()
    await nextTick()
    const button = toastElement()!.querySelector('button')!
    expect(button.hasAttribute('inert')).toBe(true)
    expect(document.querySelector('[role=status]')!.textContent).toContain('Routine deleted')
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ...modifier, bubbles: true }))
    expect(onUndo).not.toHaveBeenCalled()
    expect(useUndoToast().toast.value).not.toBeNull()
    release()
    await nextTick()
    expect(button.hasAttribute('inert')).toBe(false)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }))
    expect(onUndo).toHaveBeenCalledOnce()
  })
})

describe('UndoToast', () => {
  it('keeps the toast while its Undo stays focused after the pointer leaves', () => {
    const element = toastElement()!
    element.dispatchEvent(new PointerEvent('pointerenter'))
    element.querySelector('button')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    element.dispatchEvent(new PointerEvent('pointerleave'))
    vi.advanceTimersByTime(15001)
    expect(useUndoToast().toast.value).not.toBeNull()
  })

  it('keeps the toast while the pointer stays after focus leaves it', () => {
    const element = toastElement()!
    element.dispatchEvent(new PointerEvent('pointerenter'))
    element.querySelector('button')!.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
    element.querySelector('button')!.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: document.body }))
    vi.advanceTimersByTime(15001)
    expect(useUndoToast().toast.value).not.toBeNull()
  })

  it('does not count time while the page is hidden', () => {
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    vi.advanceTimersByTime(60000)
    expect(useUndoToast().toast.value).not.toBeNull()
    state.mockReturnValue('visible')
    document.dispatchEvent(new Event('visibilitychange'))
    state.mockRestore()
    vi.advanceTimersByTime(15000)
    expect(useUndoToast().toast.value).toBeNull()
  })

  // Two toasts never share the cell, so two Undo buttons never overlap (the visual-integrity audit caught them during
  // the cross-fade), and the new Undo is reachable at once (out-in left it out of the DOM while the old one faded).
  it('replaces a toast at once: the new one and its Undo are there immediately, the old one is no longer drawn', async () => {
    useUndoToast().show({ message: 'Moved', onUndo: vi.fn() })
    await nextTick()
    const drawn = [...document.querySelectorAll<HTMLElement>('[data-testid="undo-toast"]')].filter((element) => element.style.display !== 'none')
    expect(drawn.map((element) => element.textContent)).toEqual(['MovedUndo'])
  })
})
