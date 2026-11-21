// Brings the current hour into the middle of what is left of the window between the sticky header (the toolbar, the
// week's head and the day strip, measured where they will stay once the page scrolls) and the shell's bottom bar (the
// phone's floating tab bar, `--tabbar-inset`). The jump is instant on purpose: it is positioning on arrival, not an
// animation, so reduced-motion needs no separate branch.
export function scrollToNow(line: Element, stickyRoot: ParentNode = document, bottomInset: number = tabBarInset()): void {
  const covered = Math.max(0, ...Array.from(stickyRoot.querySelectorAll<HTMLElement>('*'))
    .filter((element) => getComputedStyle(element).position === 'sticky' && element.getClientRects().length > 0)
    .map((element) => (Number.parseFloat(getComputedStyle(element).top) || 0) + element.getBoundingClientRect().height))
  const visible = Math.max(0, window.innerHeight - bottomInset - covered)
  const top = line.getBoundingClientRect().top + window.scrollY - covered - visible / 2
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
}

// The height the shell keeps clear at the bottom for its floating tab bar (0 from 768 px, where it has none).
function tabBarInset(): number {
  const probe = document.createElement('div')
  probe.style.cssText = 'position:absolute;visibility:hidden;width:0;height:var(--tabbar-inset, 0px)'
  document.body.append(probe)
  const height = probe.getBoundingClientRect().height
  probe.remove()
  return height
}
