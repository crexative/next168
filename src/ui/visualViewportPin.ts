// iOS keeps the layout viewport still and shrinks and pans only the visual viewport when the keyboard opens. A fixed
// overlay pinned to the layout viewport therefore slides out of view. While pinned, `--vv-height` and `--vv-top` on the
// root describe the part of the page the person can see, so an overlay can size and place itself there.
const SETTLE_AFTER_FOCUS_OUT_MS = 300

let pins = 0
const afterApply = new Set<() => void>()

// Runs after each update of the pinned size and position, in the same frame: layout is already current there.
export function afterViewportPin(listener: () => void): () => void {
  afterApply.add(listener)
  return () => { afterApply.delete(listener) }
}
let unwatch: (() => void) | undefined

function watchViewport(viewport: VisualViewport): () => void {
  const root = document.documentElement
  let frame = 0
  let settle: ReturnType<typeof setTimeout> | undefined

  const apply = () => {
    frame = 0
    root.style.setProperty('--vv-height', `${Math.round(viewport.height)}px`)
    root.style.setProperty('--vv-top', `${Math.round(viewport.offsetTop)}px`)
    afterApply.forEach((listener) => listener())
  }
  const schedule = () => { if (frame === 0) frame = requestAnimationFrame(apply) }
  // iOS 26 can leave `offsetTop` stale once the keyboard has closed, so it is read again after the keyboard is gone.
  const onFocusOut = () => {
    clearTimeout(settle)
    settle = setTimeout(apply, SETTLE_AFTER_FOCUS_OUT_MS)
  }

  apply()
  viewport.addEventListener('resize', schedule)
  viewport.addEventListener('scroll', schedule)
  document.addEventListener('focusout', onFocusOut)
  return () => {
    cancelAnimationFrame(frame)
    clearTimeout(settle)
    viewport.removeEventListener('resize', schedule)
    viewport.removeEventListener('scroll', schedule)
    document.removeEventListener('focusout', onFocusOut)
    root.style.removeProperty('--vv-height')
    root.style.removeProperty('--vv-top')
  }
}

// Starts following the visual viewport; the returned release may be called any number of times. Overlays share one
// watcher, which stops with the last release.
export function pinToVisualViewport(): () => void {
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
  if (!viewport) return () => {}
  if (pins === 0) unwatch = watchViewport(viewport)
  pins += 1
  let released = false
  return () => {
    if (released) return
    released = true
    pins -= 1
    if (pins === 0) {
      unwatch?.()
      unwatch = undefined
    }
  }
}
