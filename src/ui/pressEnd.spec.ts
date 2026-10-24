import { describe, expect, it, vi } from 'vitest'
import { isHover, watchPressEnd } from './pressEnd'

function pointer(type: string, pointerId: number, buttons = 0): PointerEvent {
  const event = new Event(type, { bubbles: true }) as PointerEvent
  Object.defineProperties(event, { pointerId: { value: pointerId }, buttons: { value: buttons } })
  return event
}

describe('press end', () => {
  it('reports a release elsewhere for its own pointer only, once', () => {
    const onEnd = vi.fn()
    watchPressEnd(7, onEnd)
    window.dispatchEvent(pointer('pointerup', 3))
    expect(onEnd).not.toHaveBeenCalled()
    window.dispatchEvent(pointer('pointerup', 7))
    window.dispatchEvent(pointer('pointercancel', 7))
    expect(onEnd).toHaveBeenCalledOnce()
  })

  it('reports the window losing focus and the page being hidden', () => {
    const onBlur = vi.fn()
    watchPressEnd(1, onBlur)
    window.dispatchEvent(new Event('blur'))
    expect(onBlur).toHaveBeenCalledOnce()

    const onHidden = vi.fn()
    watchPressEnd(1, onHidden)
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
    document.dispatchEvent(new Event('visibilitychange'))
    state.mockRestore()
    expect(onHidden).toHaveBeenCalledOnce()
  })

  it('stays silent after the gesture disposed it on its own release', () => {
    const onEnd = vi.fn()
    const dispose = watchPressEnd(1, onEnd)
    dispose()
    window.dispatchEvent(pointer('pointerup', 1))
    window.dispatchEvent(new Event('blur'))
    expect(onEnd).not.toHaveBeenCalled()
  })

  it('treats a move without the primary button as hover', () => {
    expect(isHover(pointer('pointermove', 1, 0))).toBe(true)
    expect(isHover(pointer('pointermove', 1, 1))).toBe(false)
    expect(isHover(pointer('pointermove', 1, 2))).toBe(true)
  })
})
