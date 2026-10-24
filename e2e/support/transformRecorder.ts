// Keep this function self-contained: Playwright serializes it into the page.
export function installTransformRecorder(start: 'now' | 'release' = 'now'): void {
  const track = document.querySelector<HTMLElement>('[data-testid="pager-track"]')!
  const samples: string[] = []
  ;(window as unknown as { __transforms: string[] }).__transforms = samples
  const style = document.createElement('div').style
  const observer = new MutationObserver((mutations) => {
    // Skip the pre-batch state; each next oldValue is the preceding mutation's result.
    // Reading only the live style would lose transforms restored within one task.
    for (const mutation of mutations.slice(1)) {
      style.cssText = mutation.oldValue ?? ''
      samples.push(style.transform)
    }
    samples.push(track.style.transform)
  })
  const begin = () => {
    observer.observe(track, { attributes: true, attributeFilter: ['style'], attributeOldValue: true })
  }
  if (start === 'now') begin()
  else window.addEventListener('pointerup', begin, { capture: true, once: true })
}
