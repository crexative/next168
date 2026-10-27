const MARGIN_PX = 12

function scrollsVertically(element: HTMLElement): boolean {
  return /(auto|scroll)/.test(getComputedStyle(element).overflowY) && element.scrollHeight > element.clientHeight
}

// A field and the controls that act on it (its button, a note) stay visible together: mark their container.
export const KEEP_TOGETHER = '[data-keep-together]'

// Brings a field into view by moving only the scrollers between it and `boundary`, never the page: the browser's own
// scrollIntoView also scrolls the viewport, which races with the frame resizing around the keyboard.
export function keepInView(target: HTMLElement, boundary: HTMLElement): void {
  const field = target.closest<HTMLElement>(KEEP_TOGETHER) ?? target
  const limit = boundary.getBoundingClientRect()
  for (let scroller = field.parentElement; scroller && scroller !== boundary.parentElement; scroller = scroller.parentElement) {
    if (!scrollsVertically(scroller)) continue
    const area = scroller.getBoundingClientRect()
    const top = Math.max(area.top, limit.top)
    const bottom = Math.min(area.bottom, limit.bottom)
    const box = field.getBoundingClientRect()
    if (box.bottom > bottom - MARGIN_PX) scroller.scrollTop += box.bottom - (bottom - MARGIN_PX)
    else if (box.top < top + MARGIN_PX) scroller.scrollTop -= top + MARGIN_PX - box.top
  }
}
