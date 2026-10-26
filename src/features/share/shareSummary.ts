import type { Category, ColorKey, PlannerDocument } from '@/core/model'
import { plannedMinutesByCategory } from '@/core/stats'
import { occurrences } from '@/core/time'
import type { Brand } from '@/app/brand'
import { buildCapacity } from '@/features/insights/capacity'
import { categoryGlyph } from '@/ui/categoryVisual'
import { wholeHourParts } from '@/ui/format'

export type ShareColor = { key: ColorKey } | { hex: string }

export interface ShareCategory {
  name: string
  glyph: string
  color: ShareColor
  plannedMinutes: number
  // Present only when the person turned on "Show routine names".
  routines?: string[]
}

// The only input to the card's layout, paint, alt text and share text. Every field is copied explicitly from the
// document, so nothing else (tasks, events, notes, check-ins, clock times, dates, ids) can reach an image or a text.
export interface ShareSummary {
  brandName: string
  publicUrl?: string
  // Rounded together, as in the Summary's week bar, so the two always add up to 168.
  assignedHours: number
  unassignedHours: number
  // The raw planned total, which passes 168 h when routines overlap.
  plannedTotalHours: number
  overlap: boolean
  categories: ShareCategory[]
}

export interface OthersGroup { others: true; count: number; plannedMinutes: number }
export type ShareGroup = ShareCategory | OthersGroup

export const MAX_GROUPS = 6
export const MAX_GROUPS_WITH_NAMES = 4
const MAX_ROUTINES = 3

function colorOf(category: Category): ShareColor {
  return category.customColor ? { hex: category.customColor } : { key: category.colorKey }
}

// The distinct routine titles of a category, longest first by summed minutes, at most three.
function routineTitles(document: PlannerDocument, categoryId: string): string[] {
  const minutesByTitle = new Map<string, number>()
  for (const block of document.blocks) {
    if (block.categoryId !== categoryId) continue
    const minutes = occurrences(block).reduce((sum, interval) => sum + interval.end - interval.start, 0)
    minutesByTitle.set(block.title, (minutesByTitle.get(block.title) ?? 0) + minutes)
  }
  return [...minutesByTitle]
    .sort(([titleA, a], [titleB, b]) => b - a || titleA.localeCompare(titleB))
    .slice(0, MAX_ROUTINES)
    .map(([title]) => title)
}

export function buildShareSummary(document: PlannerDocument, options: { includeNames: boolean; brand: Brand }): ShareSummary {
  const planned = plannedMinutesByCategory(document)
  const capacity = buildCapacity(document.categories, planned)
  const [assignedHours, unassignedHours] = wholeHourParts([capacity.plannedMinutes, capacity.availableMinutes]) as [number, number]
  const rawTotal = document.categories.reduce((sum, category) => sum + Math.max(0, planned[category.id] ?? 0), 0)
  const categories = document.categories
    .filter((category) => (planned[category.id] ?? 0) > 0)
    .map((category): ShareCategory => {
      const entry: ShareCategory = {
        name: category.name,
        glyph: categoryGlyph(category),
        color: colorOf(category),
        plannedMinutes: planned[category.id]!,
      }
      if (options.includeNames) entry.routines = routineTitles(document, category.id)
      return entry
    })
    .sort((a, b) => b.plannedMinutes - a.plannedMinutes || a.name.localeCompare(b.name))
  const summary: ShareSummary = {
    brandName: options.brand.name,
    assignedHours,
    unassignedHours,
    plannedTotalHours: Math.round(rawTotal / 60),
    overlap: capacity.overbooked,
    categories,
  }
  if (options.brand.publicUrl) summary.publicUrl = options.brand.publicUrl
  return summary
}

export function showsNames(summary: ShareSummary): boolean {
  return summary.categories.some((category) => category.routines !== undefined)
}

export function isOthers(group: ShareGroup): group is OthersGroup {
  return 'others' in group
}

// The legend and the mosaic: at most six entries (four with names on); the last one gathers the rest as "N others".
export function shareGroups(summary: ShareSummary): ShareGroup[] {
  const limit = showsNames(summary) ? MAX_GROUPS_WITH_NAMES : MAX_GROUPS
  if (summary.categories.length <= limit) return summary.categories
  const kept = summary.categories.slice(0, limit - 1)
  const rest = summary.categories.slice(limit - 1)
  return [...kept, { others: true, count: rest.length, plannedMinutes: rest.reduce((sum, category) => sum + category.plannedMinutes, 0) }]
}
