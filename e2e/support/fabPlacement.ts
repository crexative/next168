// Floating action button placement (Material 3 FAB): a 56 px button kept 16 px (24 px from a 600 px window) from the
// screen's trailing edge, safe area added, and from whatever is docked under it: the tab bar (whose height already
// includes the bottom safe area), a status banner or the undo toast standing on it, or with nothing docked, the bottom
// safe area. Its open menu sits at least 8 px above it and wholly on screen. Like auditInPage, only the topmost modal
// sheet is audited while one is open.
//
// Separate from auditInPage on purpose: it measures one component against a fixed guideline, not the page's tokens,
// so a token changed to a wrong value is still reported.
//
// Keep this function self-contained: Playwright serializes it into the page.
export function auditFloatingActionButtonInPage(): string[] {
  const TOLERANCE = 1
  const FAB_SIZE = 56
  const MENU_GAP = 8
  const violations: string[] = []

  const visible = (element: Element | null): element is HTMLElement =>
    element instanceof HTMLElement && element.getClientRects().length > 0 && getComputedStyle(element).visibility === 'visible' && element.getBoundingClientRect().height > 0

  // Under an open modal sheet the page (and its button) is set back and inert: only the sheet is audited.
  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter((dialog) => dialog.getClientRects().length > 0)
  const scope: HTMLElement = dialogs[dialogs.length - 1] ?? document.body
  const fabs = Array.from(scope.querySelectorAll<HTMLElement>('[data-fab]')).filter(visible)
  if (fabs.length === 0) return violations

  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = window.innerHeight
  const margin = viewportWidth < 600 ? 16 : 24
  const probe = document.createElement('div')
  probe.style.cssText = 'position: fixed; visibility: hidden; width: env(safe-area-inset-right, 0px); height: env(safe-area-inset-bottom, 0px)'
  document.body.append(probe)
  const safeRight = probe.getBoundingClientRect().width
  const safeBottom = probe.getBoundingClientRect().height
  probe.remove()

  // The highest edge docked at the bottom of the screen, and what draws it.
  const docked = [
    ...Array.from(document.querySelectorAll('.tabbar')).map((element) => ({ element, name: 'the tab bar' })),
    ...Array.from(document.querySelectorAll('.banners')).map((element) => ({ element, name: 'the status banners' })),
    ...Array.from(document.querySelectorAll('[data-testid="undo-toast"]')).map((element) => ({ element, name: 'the undo toast' })),
  ].filter(({ element }) => visible(element))
  let floor = { top: viewportHeight - safeBottom, name: 'the bottom safe area' }
  for (const { element, name } of docked) {
    const top = element.getBoundingClientRect().top
    if (top < floor.top) floor = { top, name }
  }

  for (const fab of fabs) {
    const rect = fab.getBoundingClientRect()
    const label = fab.getAttribute('aria-label') ?? fab.getAttribute('data-testid') ?? 'floating action button'
    const rtl = getComputedStyle(fab).direction === 'rtl'
    if (Math.abs(rect.width - FAB_SIZE) > TOLERANCE || Math.abs(rect.height - FAB_SIZE) > TOLERANCE) {
      violations.push(`the floating button "${label}" is ${rect.width.toFixed(1)}x${rect.height.toFixed(1)}px, not ${FAB_SIZE}x${FAB_SIZE}px`)
    }
    const sideInset = rtl ? rect.left : viewportWidth - rect.right
    const expectedSide = margin + safeRight
    if (Math.abs(sideInset - expectedSide) > TOLERANCE) {
      violations.push(`the floating button "${label}" is ${sideInset.toFixed(1)}px from the screen's trailing edge, not ${expectedSide.toFixed(1)}px (${margin}px + ${safeRight.toFixed(1)}px safe area)`)
    }
    const gap = floor.top - rect.bottom
    if (Math.abs(gap - margin) > TOLERANCE) {
      violations.push(`the floating button "${label}" is ${gap.toFixed(1)}px above ${floor.name}, not ${margin}px`)
    }

    const menuId = fab.getAttribute('aria-expanded') === 'true' ? fab.getAttribute('aria-controls') : null
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
