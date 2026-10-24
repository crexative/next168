import { z } from 'zod'
import { createEmptyDocument, parseDocument, validateDocument, type DocumentEnvironment } from './documents'
import { COLOR_KEYS, dayIndexSchema, type ColorKey, type LoadResult } from './model'

const legacyTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/)
const legacySchema = z.object({
  categories: z.array(z.object({
    id: z.string(), name: z.string(), color: z.string().regex(/^#[\da-fA-F]{6}$/),
    weeklyHourLimit: z.number(), icon: z.string().optional(),
  })),
  timeBlocks: z.array(z.object({
    id: z.string(), categoryId: z.string(), title: z.string(), description: z.string().optional(),
    dayOfWeek: dayIndexSchema, repeatDays: z.array(dayIndexSchema).optional(),
    startTime: legacyTime, endTime: legacyTime, durationMinutes: z.number(),
  })),
})
const palette: Record<ColorKey, string> = {
  blue: '#007AFF', green: '#34C759', orange: '#FF9500', pink: '#FF2D55', purple: '#AF52DE',
  teal: '#30B0C7', yellow: '#FFCC00', red: '#FF3B30', gray: '#8E8E93',
}
const rgb = (hex: string) => [1, 3, 5].map((offset) => parseInt(hex.slice(offset, offset + 2), 16))
function nearestColor(hex: string): ColorKey {
  const channels = rgb(hex)
  return COLOR_KEYS.reduce((best, key) => {
    const distance = (color: ColorKey) => rgb(palette[color]).reduce((sum, value, i) => sum + (value - channels[i]!) ** 2, 0)
    return distance(key) < distance(best) ? key : best
  })
}
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3))

export function migrateToCurrent(raw: unknown, env: DocumentEnvironment): LoadResult {
  let serialized = typeof raw === 'string' ? raw : '[non-JSON input]'
  try {
    if (typeof raw !== 'string') serialized = JSON.stringify(raw) ?? serialized
    const value: unknown = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (typeof value === 'object' && value !== null && 'schemaVersion' in value && value.schemaVersion !== 1) {
      return parseDocument(serialized)
    }
    const legacy = legacySchema.parse(value)
    const document = createEmptyDocument(env)
    document.categories = legacy.categories.map((category) => ({
      id: category.id, name: category.name, icon: category.icon, colorKey: nearestColor(category.color),
      customColor: category.color, goal: { type: 'max', hoursPerWeek: category.weeklyHourLimit },
    }))
    document.blocks = legacy.timeBlocks.map((block) => ({
      id: block.id, categoryId: block.categoryId, title: block.title, notes: block.description,
      days: [...new Set([block.dayOfWeek, ...(block.repeatDays ?? [])])],
      start: minutes(block.startTime), end: minutes(block.endTime),
    }))
    document.settings.onboardingDone = legacy.timeBlocks.length > 0 || !!env.tutorialCompleted
    return { kind: 'ok', document: validateDocument(document), migratedFrom: 1 }
  } catch (error) {
    return { kind: 'corrupt', raw: serialized, reason: error instanceof Error ? error.message : String(error) }
  }
}
