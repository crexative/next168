import { currentAndNext } from '@/core/now'
import { scheduleTasks } from '@/core/scheduler'
import { computeStats } from '@/core/stats'
import type { Category, PlannerDocument } from '@/core/model'
import {
  formatDuration,
  type AskContext, type AssistantAnswer, type AssistantProvider, type Availability, type Translate,
} from './provider'
import { matchesIntent, mentionsHours, normalize } from './rulesLexicon'
import { formatDate } from '@/features/week/localTime'
import { displayLocaleFor, formatClock } from '@/ui/format'

function mentionedCategory(question: string, categories: Category[]): Category | undefined {
  const text = normalize(question)
  const words = new Set(text.split(/[^\p{L}\p{N}]+/u))
  const scored = categories.map((category) => {
    const name = normalize(category.name)
    if (text.includes(name)) return { category, score: name.length + 100 }
    const partial = name.split(/[^\p{L}\p{N}]+/u).filter((word) => word.length >= 4 && words.has(word))
    return { category, score: partial.reduce((sum, word) => sum + word.length, 0) }
  })
  return scored.filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score)[0]?.category
}

function categoryLine(document: PlannerDocument, category: Category, t: Translate): string {
  const stats = computeStats(document).categories.find((entry) => entry.categoryId === category.id)!
  const planned = formatDuration(stats.plannedMinutes)
  const name = category.name
  switch (stats.goal.kind) {
    case 'over': return t('assistant.answers.categoryOver', { category: name, planned, amount: formatDuration(stats.goal.minutes), goal: formatDuration(category.goal.hoursPerWeek * 60) })
    case 'missing': return t('assistant.answers.categoryMissing', { category: name, planned, amount: formatDuration(stats.goal.minutes), goal: formatDuration(category.goal.hoursPerWeek * 60) })
    default: return t('assistant.answers.categoryPlanned', { category: name, planned })
  }
}

function remainingLine(document: PlannerDocument, category: Category, t: Translate): string {
  const planned = formatDuration(computeStats(document).categories.find((entry) => entry.categoryId === category.id)!.plannedMinutes)
  const goal = category.goal
  if (goal.type === 'none') return t('assistant.answers.categoryNoGoal', { category: category.name, planned })
  const difference = goal.hoursPerWeek * 60 - computeStats(document).categories.find((entry) => entry.categoryId === category.id)!.plannedMinutes
  const key = goal.type === 'max'
    ? difference >= 0 ? 'assistant.answers.maxRoomLeft' : 'assistant.answers.maxExceeded'
    : difference > 0 ? 'assistant.answers.minStillNeeded' : 'assistant.answers.minReached'
  return t(key, { category: category.name, planned, amount: formatDuration(Math.abs(difference)), goal: formatDuration(goal.hoursPerWeek * 60) })
}

export function isChangeRequest(question: string): boolean {
  return matchesIntent('change', question)
}

// Deterministic facts for a question, or undefined when no intent applies. Shared with the model
// provider so that its answers can be checked against the same numbers.
export function answerFromStats(question: string, { document, now, timeZone, locale, translate: t }: AskContext): string | undefined {
  const category = mentionedCategory(question, document.categories)
  const stats = computeStats(document)

  if (matchesIntent('nextBlock', question)) {
    const { current, next } = currentAndNext(document, now, timeZone)
    const parts: string[] = []
    if (current) parts.push(t('assistant.answers.currentBlock', { title: current.title, minutes: current.minutesLeft }))
    parts.push(next
      ? t('assistant.answers.nextBlock', {
        title: next.title,
        date: formatDate(next.date, displayLocaleFor(locale), { weekday: 'long', day: 'numeric', month: 'long' }),
        time: formatClock(next.start, displayLocaleFor(locale), timeZone),
      })
      : t('assistant.answers.noNextBlock'))
    return parts.join(' ')
  }
  if (matchesIntent('overflow', question)) {
    const late = scheduleTasks({ document, busy: [], now, timeZone })
    const overflowing = late.filter((placement) => placement.overflowMinutes > 0 || placement.late)
    if (overflowing.length === 0) return t('assistant.answers.noOverflow')
    const titles = overflowing.map((placement) => document.tasks.find((task) => task.id === placement.taskId)?.title ?? placement.taskId)
    const minutes = overflowing.reduce((sum, placement) => sum + placement.overflowMinutes, 0)
    return t('assistant.answers.overflow', { count: overflowing.length, titles: titles.join(', '), amount: formatDuration(minutes) })
  }
  if (!category && matchesIntent('unassigned', question)) {
    return t('assistant.answers.unassigned', { amount: formatDuration(stats.unassignedHours * 60), planned: formatDuration(stats.plannedMinutes) })
  }
  if (category && matchesIntent('remaining', question)) return remainingLine(document, category, t)
  if (category) return categoryLine(document, category, t)
  if (mentionsHours(question)) {
    const lines = document.categories.map((entry) => categoryLine(document, entry, t))
    return [t('assistant.answers.totalPlanned', { planned: formatDuration(stats.plannedMinutes) }), ...lines].join('\n')
  }
  return undefined
}

export class RulesProvider implements AssistantProvider {
  readonly id = 'rules'

  async availability(): Promise<Availability> {
    return 'available'
  }

  async prepare(): Promise<void> {}

  async ask(question: string, context: AskContext): Promise<AssistantAnswer> {
    if (isChangeRequest(question)) {
      const key = context.modelAvailability === 'unavailable' ? 'rulesCannotChangeHere' : 'rulesCannotChange'
      return { answer: context.translate(`assistant.answers.${key}`) }
    }
    return { answer: answerFromStats(question, context) ?? context.translate('assistant.answers.rulesUnknown') }
  }

  async dispose(): Promise<void> {}
}
