// Brings the current hour into the middle of the window. The jump is instant on purpose: it is
// positioning on arrival, not an animation, so reduced-motion needs no separate branch.
export function scrollToNow(line: Element): void {
  const top = line.getBoundingClientRect().top + window.scrollY - window.innerHeight / 2
  window.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
}
