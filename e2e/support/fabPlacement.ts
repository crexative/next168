// The phone's floating "+" (redesign 2026-11, DIRECTION §6 "Tab bar (phone)"): a 60 px round button beside the
// floating tab bar. Both float 16 px above the bottom safe area; the "+" keeps 16 px (plus the safe area) from the
// screen's trailing edge and 16 px from the tab bar's trailing end. Nothing docked over the bottom (a status banner,
// the undo toast) may cover it, and its open menu sits at least 8 px above it and wholly on screen. Like auditInPage,
// only the topmost modal sheet is audited while one is open.
//
// Separate from auditInPage on purpose: it measures one component against a fixed spec, not the page's tokens, so a
// token changed to a wrong value is still reported.
//
// Keep this function self-contained: Playwright serializes it into the page.
export function auditFloatingActionButtonInPage(): string[] {
  const TOLERANCE = 1
  const SIZE = 60
  const MARGIN = 16
  const MENU_GAP = 8
  const violations: string[] = []

  const visible = (element: Element | null): element is HTMLElement =>
    element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible' && element.getBoundingClientRect().height > 0

  // Under an open modal sheet the page (and its button) is set back and inert: only the sheet is audited.
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter((dialog) => dialog.getClientRects().length > 0)
  const scope: HTMLElement = dialogs[dialogs.length - 1] ?? document.body
  const buttons = Array.from(scope.querySelectorAll<HTMLElement>('[data-floating-add]')).filter(visible)
  if (buttons.length === 0) return violations

  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = window.innerHeight
  const probe = document.createElement('div')
  probe.style.cssText = 'position: fixed; visibility: hidden; width: env(safe-area-inset-right, 0px); height: env(safe-area-inset-bottom, 0px)'
  document.body.append(probe)
  const safeRight = probe.getBoundingClientRect().width
  const safeBottom = probe.getBoundingClientRect().height
  probe.remove()

  const tabbar = Array.from(document.querySelectorAll('.tabbar')).find(visible)
  const covers = [
    ...Array.from(document.querySelectorAll('.banners')).map((element) => ({ element, name: 'the status banners' })),
    ...Array.from(document.querySelectorAll('[data-testid="undo-toast"]')).map((element) => ({ element, name: 'the undo toast' })),
  ].filter(({ element }) => visible(element))

  for (const button of buttons) {
    const rect = button.getBoundingClientRect()
    const label = button.getAttribute('aria-label') ?? button.getAttribute('data-testid') ?? 'floating add button'
    const rtl = getComputedStyle(button).direction === 'rtl'
    if (Math.abs(rect.width - SIZE) > TOLERANCE || Math.abs(rect.height - SIZE) > TOLERANCE) {
      violations.push(`the floating button "${label}" is ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}px, not ${SIZE}x${SIZE}px`)
    }
    const sideInset = rtl ? rect.left : viewportWidth - rect.right
    const expectedSide = MARGIN + safeRight
    if (Math.abs(sideInset - expectedSide) > TOLERANCE) {
      violations.push(`the floating button "${label}" is ${sideInset.toFixed(1)}px from the screen's trailing edge, not ${expectedSide.toFixed(1)}px (${MARGIN}px + ${safeRight.toFixed(1)}px safe area)`)
    }
    const lift = viewportHeight - safeBottom - rect.bottom
    if (Math.abs(lift - MARGIN) > TOLERANCE) {
      violations.push(`the floating button "${label}" is ${lift.toFixed(1)}px above the bottom safe area, not ${MARGIN}px`)
    }
    if (tabbar) {
      const bar = tabbar.getBoundingClientRect()
      if (Math.abs(bar.bottom - rect.bottom) > TOLERANCE) {
        violations.push(`the floating button "${label}" ends ${(bar.bottom - rect.bottom).toFixed(1)}px off the tab bar's bottom edge`)
      }
      const gap = rtl ? bar.left - rect.right : rect.left - bar.right
      if (Math.abs(gap - MARGIN) > TOLERANCE) violations.push(`the floating button "${label}" is ${gap.toFixed(1)}px from the tab bar, not ${MARGIN}px`)
    }
    for (const { element, name } of covers) {
      const other = element.getBoundingClientRect()
      if (other.bottom > rect.top + TOLERANCE && other.top < rect.bottom - TOLERANCE && other.right > rect.left + TOLERANCE && other.left < rect.right - TOLERANCE) {
        violations.push(`${name} covers the floating button "${label}"`)
      }
    }

    const menuId = button.getAttribute('aria-expanded') === 'true' ? button.getAttribute('aria-controls') : null
    const menu = menuId ? document.getElementById(menuId) : null
    if (!visible(menu)) continue
    const box = menu.getBoundingClientRect()
    const menuGap = rect.top - box.bottom
    if (menuGap < MENU_GAP - TOLERANCE) violations.push(`the menu of "${label}" is ${menuGap.toFixed(1)}px above it, less than ${MENU_GAP}px`)
    if (box.left < -TOLERANCE || box.top < -TOLERANCE || box.right > viewportWidth + TOLERANCE || box.bottom > viewportHeight + TOLERANCE) {
      violations.push(`the menu of "${label}" leaves the screen (${box.left.toFixed(1)}, ${box.top.toFixed(1)}, ${box.right.toFixed(1)}, ${box.bottom.toFixed(1)} in ${viewportWidth}x${viewportHeight})`)
    }
  }
  return violations
}
