import type { Page } from '@playwright/test'

// "+" in Week opens a menu with Block and Event (in English); `name` is the entry's visible text.
export async function addFromMenu(page: Page, name: string): Promise<void> {
  await page.getByTestId('week-add').click()
  await page.getByRole('menuitem', { name, exact: true }).click()
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
