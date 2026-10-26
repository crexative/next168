import type { Page } from '@playwright/test'

// "+" in Week opens a menu with Block and Event (in English); `name` is the entry's visible text.
export async function addFromMenu(page: Page, name: string): Promise<void> {
  await page.getByTestId('week-add').click()
  await page.getByRole('menuitem', { name, exact: true }).click()
}

// The classic "New routine" form: a press on an empty hour of the visible day column (Week "+" › Routine opens the
// guided add instead). The press lands where nothing but the column itself is under the pointer.
export async function openClassicRoutine(page: Page): Promise<void> {
  for (let attempt = 0; attempt < 3; attempt++) {
    // The week scrolls to the current hour and the day pager settles on arrival: press once nothing moves.
    await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState !== 'running'))
    const point = await page.evaluate(async () => {
      const scrolled = () => Array.from(document.querySelectorAll<HTMLElement>('*')).filter((element) => element.scrollTop > 0 || element.scrollLeft > 0).map((element) => `${element.scrollTop},${element.scrollLeft}`).join('|') + `|${window.scrollY}`
      let before = scrolled()
      for (let frames = 0; frames < 60; frames++) {
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const now = scrolled()
        if (now === before && frames > 3) break
        before = now
      }
      const columns = Array.from(document.querySelectorAll<HTMLElement>('.day-column')).filter((column) => {
        const rect = column.getBoundingClientRect()
        return rect.width > 0 && rect.left >= 0 && rect.right <= window.innerWidth + 1 && !column.closest('[aria-hidden=true]')
      })
      for (const column of columns) {
        const rect = column.getBoundingClientRect()
        const x = rect.left + Math.min(20, rect.width / 2)
        for (let y = Math.max(rect.top, 0) + 8; y < Math.min(rect.bottom, window.innerHeight) - 8; y += 12) {
          if (document.elementFromPoint(x, y) === column) return { x, y }
        }
      }
      return null
    })
    if (!point) throw new Error('no empty hour on screen to press')
    await page.mouse.click(point.x, point.y)
    if (await page.getByRole('dialog').first().isVisible({ timeout: 1000 }).catch(() => false)) return
    await page.waitForTimeout(300)
    if (await page.getByRole('dialog').count() > 0) return
  }
  throw new Error('pressing an empty hour opened no sheet')
}

// The full titles a week was seeded with, by item id: what each item's accessible name must contain, independent of
// anything the page draws or labels.
export interface SeededTitles {
  blocks: Record<string, string>
  events: Record<string, string>
  tasks: Record<string, string>
}

export function seededTitles(document: { blocks: { id: string; title: string }[]; events?: { id: string; title: string }[]; tasks?: { id: string; title: string }[] }): SeededTitles {
  const byId = (items: { id: string; title: string }[] = []) => Object.fromEntries(items.map((item) => [item.id, item.title]))
  return { blocks: byId(document.blocks), events: byId(document.events), tasks: byId(document.tasks) }
}

// Week items (routines, own events, tasks) whose accessible name does not contain their seeded title, and how many
// items were checked. The name is the item's aria-label, else its text without aria-hidden parts.
export async function itemsMissingTitles(page: Page, titles: SeededTitles): Promise<{ checked: number; missing: string[] }> {
  return page.evaluate((expected) => {
    const accessibleName = (item: HTMLElement) => {
      const label = item.getAttribute('aria-label')
      if (label) return label
      const walker = document.createTreeWalker(item, NodeFilter.SHOW_TEXT)
      let text = ''
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        // Only aria-hidden parts of the item itself: a day page off screen is aria-hidden as a whole.
        const hidden = node.parentElement?.closest('[aria-hidden="true"]')
        if (!hidden || !item.contains(hidden)) text += node.textContent ?? ''
      }
      return text
    }
    const kinds = [['block', '[data-block-id]', 'data-block-id', expected.blocks], ['event', '[data-event-id]', 'data-event-id', expected.events], ['task', '[data-task-id]', 'data-task-id', expected.tasks]] as const
    let checked = 0
    const missing: string[] = []
    for (const [kind, selector, attribute, byId] of kinds) {
      for (const item of Array.from(document.querySelectorAll<HTMLElement>(`.day-column ${selector}`))) {
        const title = byId[item.getAttribute(attribute) ?? '']
        if (title === undefined) continue
        checked += 1
        const name = accessibleName(item).replace(/\s+/g, ' ').trim()
        if (!name.includes(title.replace(/\s+/g, ' ').trim())) missing.push(`${kind} ${item.getAttribute(attribute)}: "${name}" does not name "${title}"`)
      }
    }
    return { checked, missing: Array.from(new Set(missing)) }
  }, titles)
}
