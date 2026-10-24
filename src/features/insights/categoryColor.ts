import type { Category } from '@/core/model'

export function categoryColor(category: Pick<Category, 'colorKey' | 'customColor'>): string {
  return category.customColor ?? `var(--cat-${category.colorKey})`
}
