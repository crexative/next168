import { describe, expect, it } from 'vitest'
import type { PlannerDocument } from '@/core/model'
import { createEmptyDocument } from '@/core/documents'
import { SUPPORTED_LOCALES, collectMessages } from './index'
import { answerFromStats } from '@/features/assistant/RulesProvider'

const messages = collectMessages(import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true }))
const get = (locale: string, path: string) => path.split('.').reduce<unknown>((node, part) => (node as Record<string, unknown>)[part], messages[locale]) as string

const document: PlannerDocument = {
  ...createEmptyDocument({ now: new Date('2026-10-21T10:00:00Z'), locale: 'en', timeZone: 'UTC' }),
  categories: [{ id: 'c', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
  blocks: [{ id: 'b', categoryId: 'c', title: 'Deep', days: [1, 2, 3, 4, 5], start: 540, end: 720 }],
}

describe.each(SUPPORTED_LOCALES)('%s setup copy', (locale) => {
  it.each(['hours', 'next', 'overflow'])('the suggested question "%s" is one the quick answers understand', (key) => {
    const answer = answerFromStats(get(locale, `assistant.suggestions.${key}`), {
      document, now: new Date('2026-10-21T10:00:00Z'), locale, timeZone: 'UTC',
      translate: (id, params) => `${id}:${JSON.stringify(params ?? {})}`,
    })
    expect(answer, get(locale, `assistant.suggestions.${key}`)).toBeDefined()
  })

  it('never says LLM to the person', () => {
    expect(get(locale, 'connect.title')).not.toMatch(/LLM/)
  })

  it('has singular and plural forms where a count is shown', () => {
    for (const path of ['assistant.answers.overflow']) {
      expect(get(locale, path).split('|'), path).toHaveLength(2)
    }
    for (const path of ['categories.usage.blocks', 'categories.usage.tasks']) expect(get(locale, path).split('|'), path).toHaveLength(3)
  })

  it('keeps the same placeholders as English in every new string', () => {
    const names = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort().filter((name, index, all) => all.indexOf(name) === index)
    for (const path of ['onboarding.assigned', 'onboarding.unassigned', 'onboarding.counterOver', 'onboarding.editRoutine', 'onboarding.done.task', 'settings.exportNudge.overdue', 'setup.backTo', 'assistant.status.line', 'categories.inUse']) {
      expect(names(get(locale, path)), `${locale}:${path}`).toEqual(names(get('en', path)))
    }
  })
})
