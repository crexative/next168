import { createI18n } from 'vue-i18n'
import type { PlannerDocument } from '@/core/model'
import { document as emptyDocument } from '@/core/__tests__/fixtures'
import type { AskContext } from './provider'

const files = import.meta.glob<{ default: Record<string, unknown> }>('../../i18n/*/assistant.json', { eager: true })

export function translatorFor(locale: string) {
  const messages: Record<string, { assistant: unknown }> = {}
  for (const [path, module] of Object.entries(files)) {
    messages[/i18n\/([^/]+)\//.exec(path)![1]!] = { assistant: module.default }
  }
  const i18n = createI18n<false>({ legacy: false, locale, fallbackLocale: 'en', messages: messages as never })
  return (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {})
}

// Work: Mon-Wed 09:00-13:00 (12 h) + Fri 15:00-16:00 (1 h) = 13 h planned of a 40 h max.
// Study: min goal 5 h, Tue 18:00-20:00 = 2 h planned.
export function plannerWithBlocks(): PlannerDocument {
  const document = emptyDocument()
  document.categories.push({ id: 'study', name: 'Study', colorKey: 'green', goal: { type: 'min', hoursPerWeek: 5 } })
  document.blocks.push(
    { id: 'work-am', categoryId: 'work', title: 'Deep work', days: [1, 2, 3], start: 540, end: 780 },
    { id: 'work-fri', categoryId: 'work', title: 'Review', days: [5], start: 900, end: 960 },
    { id: 'study-tue', categoryId: 'study', title: 'Reading', days: [2], start: 1080, end: 1200 },
  )
  return document
}

export function contextFor(document: PlannerDocument, locale = 'en', now = new Date('2026-10-24T12:00:00Z')): AskContext {
  return { document, now, locale, timeZone: 'UTC', translate: translatorFor(locale) }
}
