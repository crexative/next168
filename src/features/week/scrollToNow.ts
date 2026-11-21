// Brings the current hour into the middle of what is left of the window under the sticky header (the toolbar, the
// week's head and the day strip, measured where they will stay once the page scrolls). The jump is instant on purpose:
// it is positioning on arrival, not an animation, so reduced-motion needs no separate branch.
export function scrollToNow(line: Element, stickyRoot: ParentNode = document): void {
  const covered = Math.max(0, ...Array.from(stickyRoot.querySelectorAll<HTMLElement>('*'))
    .filter((element) => getComputedStyle(element).position === 'sticky' && element.getClientRects().length > 0)
    .map((element) => (Number.parseFloat(getComputedStyle(element).top) || 0) + element.getBoundingClientRect().height))
  const visible = window.innerHeight - covered
  const top = line.getBoundingClientRect().top + window.scrollY - covered - visible / 2
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
}
