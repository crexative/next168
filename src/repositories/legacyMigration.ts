// TODO(#3): replace with core migrations (src/core/migrations.ts `migrateToCurrent`)
import { z } from 'zod'
import {
  COLOR_KEYS, SCHEMA_VERSION, plannerDocumentSchema,
  type Category, type ColorKey, type PlannerDocument, type TimeBlock,
} from '@/core/model'

export interface MigrationContext {
  now: Date
  locale: string
  timeZone: string
  tutorialCompleted: boolean
  newId: () => string
}

export class MigrationError extends Error {}

const legacyCategorySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  color: z.string().optional(),
  weeklyHourLimit: z.number().optional(),
  icon: z.string().optional(),
})

const legacyBlockSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().min(1),
  title: z.string().optional(),
  description: z.string().optional(),
  dayOfWeek: z.number().int().min(0).max(6),
  startTime: z.string(),
  endTime: z.string(),
  repeatDays: z.array(z.number().int().min(0).max(6)).optional(),
})

const legacyDataSchema = z.object({
  categories: z.array(legacyCategorySchema),
  timeBlocks: z.array(legacyBlockSchema),
})

const PALETTE_HEX: Record<ColorKey, string> = {
  blue: '#007aff', green: '#34c759', orange: '#ff9500', pink: '#ff2d55', purple: '#af52de',
  teal: '#30b0c7', yellow: '#ffcc00', red: '#ff3b30', gray: '#8e8e93',
}

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/

function rgb(hex: string): [number, number, number] {
  const value = parseInt(hex.slice(1), 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

export function nearestColorKey(hex: string): ColorKey {
  const [r, g, b] = rgb(hex)
  let best: ColorKey = 'gray'
  let bestDistance = Infinity
  for (const key of COLOR_KEYS) {
    const [pr, pg, pb] = rgb(PALETTE_HEX[key])
    const distance = (r - pr) ** 2 + (g - pg) ** 2 + (b - pb) ** 2
    if (distance < bestDistance) { best = key; bestDistance = distance }
  }
  return best
}

function toMinute(time: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time)
  if (!match) return undefined
  const minutes = Number(match[1]) * 60 + Number(match[2])
  return minutes >= 0 && minutes < 1440 ? minutes : undefined
}

const clamp = (value: string, max: number) => value.trim().slice(0, max)

function migrateCategory(legacy: z.infer<typeof legacyCategorySchema>): Category {
  const hex = legacy.color && HEX_COLOR.test(legacy.color) ? legacy.color : undefined
  const hours = Math.min(168, Math.max(0, legacy.weeklyHourLimit ?? 0))
  return {
    id: legacy.id.slice(0, 64),
    name: clamp(legacy.name, 60) || 'Category',
    colorKey: hex ? nearestColorKey(hex) : 'gray',
    ...(hex ? { customColor: hex } : {}),
    ...(legacy.icon ? { icon: legacy.icon.slice(0, 16) } : {}),
    goal: { type: 'max', hoursPerWeek: hours },
  }
}

function migrateBlock(legacy: z.infer<typeof legacyBlockSchema>, knownCategories: Set<string>): TimeBlock | undefined {
  const start = toMinute(legacy.startTime)
  const end = toMinute(legacy.endTime)
  if (start === undefined || end === undefined || start === end || !knownCategories.has(legacy.categoryId)) return undefined
  const days = [...new Set([legacy.dayOfWeek, ...(legacy.repeatDays ?? [])])].sort((a, b) => a - b)
  return {
    id: legacy.id.slice(0, 64),
    categoryId: legacy.categoryId.slice(0, 64),
    title: clamp(legacy.title ?? '', 80) || 'Block',
    ...(legacy.description?.trim() ? { notes: legacy.description.slice(0, 500) } : {}),
    days,
    start,
    end,
  }
}

export function migrateToCurrent(raw: unknown, context: MigrationContext): PlannerDocument {
  const parsed = legacyDataSchema.safeParse(raw)
  if (!parsed.success) throw new MigrationError('legacy-shape-invalid')

  const categories = parsed.data.categories.map(migrateCategory)
  const knownCategories = new Set(categories.map((category) => category.id))
  const blocks = parsed.data.timeBlocks
    .map((block) => migrateBlock(block, knownCategories))
    .filter((block): block is TimeBlock => block !== undefined)

  const document: PlannerDocument = {
    schemaVersion: SCHEMA_VERSION,
    workspaceId: context.newId(),
    revision: 0,
    updatedAt: context.now.toISOString(),
    settings: {
      locale: context.locale,
      weekStartsOn: 1,
      timeZone: context.timeZone,
      onboardingDone: context.tutorialCompleted || categories.length > 0 || blocks.length > 0,
      theme: 'system',
    },
    categories,
    blocks,
    tasks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [],
  }
  const checked = plannerDocumentSchema.safeParse(document)
  if (!checked.success) throw new MigrationError('migrated-document-invalid')
  return checked.data
}
