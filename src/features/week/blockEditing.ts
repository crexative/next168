import type { Category, DayIndex, PlannerDocument, TimeBlock } from '@/core/model'
import { goalStatus, plannedMinutesByCategory } from '@/core/stats'
import { overlaps } from '@/core/time'

export interface BlockDraft {
  id?: string
  title: string
  categoryId: string
  start: number | null
  end: number | null
  days: DayIndex[]
}

export type DraftError =
  | { code: 'titleRequired' | 'categoryRequired' | 'timeRequired' | 'zeroLength' | 'daysRequired' }
  | { code: 'overlap'; blockTitle: string }

export interface DraftWarning { code: 'goalOver'; categoryName: string; minutes: number }

export interface DraftValidation {
  errors: DraftError[]
  warnings: DraftWarning[]
  block: TimeBlock | null
}

const DRAFT_ID = '__draft__'

export function validateBlockDraft(draft: BlockDraft, document: PlannerDocument): DraftValidation {
  const errors: DraftError[] = []
  const title = draft.title.trim()
  const category = document.categories.find((item) => item.id === draft.categoryId)
  if (!title) errors.push({ code: 'titleRequired' })
  if (!category) errors.push({ code: 'categoryRequired' })
  if (draft.start === null || draft.end === null) errors.push({ code: 'timeRequired' })
  else if (draft.start === draft.end) errors.push({ code: 'zeroLength' })
  if (!draft.days.length) errors.push({ code: 'daysRequired' })
  if (draft.start === null || draft.end === null || draft.start === draft.end || !draft.days.length) {
    return { errors, warnings: [], block: null }
  }

  const candidate: TimeBlock = {
    id: draft.id ?? DRAFT_ID, categoryId: draft.categoryId, title: title || DRAFT_ID,
    days: [...new Set(draft.days)].sort((a, b) => a - b), start: draft.start, end: draft.end,
  }
  const others = document.blocks.filter((block) => block.id !== draft.id)
  const clash = others.find((block) => overlaps(candidate, block))
  if (clash) errors.push({ code: 'overlap', blockTitle: clash.title })

  const warnings = category ? goalWarnings(category, { ...document, blocks: [...others, candidate] }) : []
  if (errors.length) return { errors, warnings, block: null }
  const existing = document.blocks.find((block) => block.id === draft.id)
  return { errors, warnings, block: { ...existing, ...candidate, title } }
}

function goalWarnings(category: Category, projected: PlannerDocument): DraftWarning[] {
  const status = goalStatus(category.goal, plannedMinutesByCategory(projected)[category.id] ?? 0)
  return status.kind === 'over' ? [{ code: 'goalOver', categoryName: category.name, minutes: status.minutes }] : []
}

export function upsertBlock(draft: PlannerDocument, block: TimeBlock): void {
  const index = draft.blocks.findIndex((item) => item.id === block.id)
  if (index === -1) draft.blocks.push(block)
  else draft.blocks[index] = block
}

export function removeBlock(draft: PlannerDocument, id: string): void {
  draft.blocks = draft.blocks.filter((block) => block.id !== id)
}

export function restoreBlock(draft: PlannerDocument, block: TimeBlock, index: number): void {
  if (draft.blocks.some((item) => item.id === block.id)) return
  draft.blocks.splice(Math.min(index, draft.blocks.length), 0, block)
}
