import type { Category, ColorKey } from '@/core/model'
import { firstUnusedColorKey } from '@/core/colorKeys'

export { firstUnusedColorKey }

export function categoryColor(category: Pick<Category, 'colorKey' | 'customColor'>): string {
  return category.customColor ?? `var(--cat-${category.colorKey})`
}

// Keeps each wanted colour unless an earlier entry, or a colour already taken elsewhere, has it; then the entry gets the
// first unused colour.
export function distinctColorKeys(wanted: readonly ColorKey[], alreadyTaken: readonly ColorKey[] = []): ColorKey[] {
  const taken = [...alreadyTaken]
  return wanted.map((key) => {
    const chosen = taken.includes(key) ? firstUnusedColorKey(taken) : key
    taken.push(chosen)
    return chosen
  })
}

// Another category (not the one being edited) painted with the same palette colour, if any.
export function categorySharingColor(categories: readonly Category[], colorKey: ColorKey, selfId: string | null): Category | undefined {
  return categories.find((category) => category.id !== selfId && !category.customColor && category.colorKey === colorKey)
}
