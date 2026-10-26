import type { Page } from '@playwright/test'

// The tap-budget counter (P0 spec §5.1), installed before the app loads. An action is a trusted primary pointerup, or a
// trusted Enter, or a Space outside a text field. Typing is never counted, and programmatic clicks or dispatched
// events are untrusted, so no test helper can hide or invent an action.
declare global {
  interface Window { __actions: unknown[] }
}

export async function installTapCounter(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.__actions = []
    const editable = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable
      || target.matches('input:not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]), textarea, select'))
    addEventListener('pointerup', (event) => {
      if (event.isTrusted && event.button === 0) window.__actions.push(['pointer', event.pointerType, (event.target as HTMLElement | null)?.dataset?.testid ?? (event.target as Element | null)?.tagName])
    }, true)
    addEventListener('keydown', (event) => {
      if (!event.isTrusted || event.repeat || event.isComposing) return
      if (event.key === 'Enter' || (event.key === ' ' && !editable(event.target))) window.__actions.push(['key', event.key])
    }, true)
  })
}

export const tapCount = (page: Page): Promise<number> => page.evaluate(() => window.__actions.length)
export const tapActions = (page: Page): Promise<unknown[]> => page.evaluate(() => window.__actions)
