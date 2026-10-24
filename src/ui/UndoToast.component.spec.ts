import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import UndoToast from './UndoToast.vue'
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
})
