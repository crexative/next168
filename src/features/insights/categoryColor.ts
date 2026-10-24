import { COLOR_KEYS, type Category, type ColorKey } from '@/core/model'

export function categoryColor(category: Pick<Category, 'colorKey' | 'customColor'>): string {
  return category.customColor ?? `var(--cat-${category.colorKey})`
}

// The first palette colour not yet in use; once every colour is taken, the least used one (first in palette order on ties).
export function firstUnusedColorKey(used: readonly ColorKey[]): ColorKey {
  const counts = new Map<ColorKey, number>(COLOR_KEYS.map((key) => [key, 0]))
  for (const key of used) counts.set(key, (counts.get(key) ?? 0) + 1)
  const least = Math.min(...counts.values())
  return COLOR_KEYS.find((key) => counts.get(key) === least)!
}

// Keeps each wanted colour unless an earlier entry already took it; then the entry gets the first unused colour.
export function distinctColorKeys(wanted: readonly ColorKey[]): ColorKey[] {
  const taken: ColorKey[] = []
  for (const key of wanted) taken.push(taken.includes(key) ? firstUnusedColorKey(taken) : key)
  return taken
}

// Another category (not the one being edited) painted with the same palette colour, if any.
export function categorySharingColor(categories: readonly Category[], colorKey: ColorKey, selfId: string | null): Category | undefined {
  return categories.find((category) => category.id !== selfId && !category.customColor && category.colorKey === colorKey)
}
