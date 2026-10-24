// A press can end where the pressed element never hears it: released or cancelled outside it (before any pointer
// capture), the window losing focus, or the page being hidden. Gestures register here when a press starts and
// get one `onEnd` call for any of those; their own pointerup handler disposes the watch first, so a normal
// release is never reported twice.
export function watchPressEnd(pointerId: number, onEnd: () => void): () => void {
  const end = (): void => {
    dispose()
    onEnd()
  }
  const onPointerEnd = (event: PointerEvent): void => { if (event.pointerId === pointerId) end() }
  const onVisibility = (): void => { if (document.visibilityState === 'hidden') end() }
  function dispose(): void {
    window.removeEventListener('pointerup', onPointerEnd)
    window.removeEventListener('pointercancel', onPointerEnd)
    window.removeEventListener('blur', end)
    document.removeEventListener('visibilitychange', onVisibility)
  }
  window.addEventListener('pointerup', onPointerEnd)
  window.addEventListener('pointercancel', onPointerEnd)
  window.addEventListener('blur', end)
  document.addEventListener('visibilitychange', onVisibility)
  return dispose
}

// A move with the primary button up is hover, never part of a press (a release the element missed).
export function isHover(event: PointerEvent): boolean {
  return (event.buttons & 1) === 0
}
