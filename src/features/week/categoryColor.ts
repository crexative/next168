import type { Category } from '@/core/model'

export function categoryColor(category: Category | undefined): string {
  if (!category) return 'var(--cat-gray)'
  return category.customColor ?? `var(--cat-${category.colorKey})`
}
