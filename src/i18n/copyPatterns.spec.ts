// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { daysPhrase } from '@/features/onboarding/routineText'
import { createState, ensureCategory } from '@/features/onboarding/setupModel'
import { documentWith, env } from '@/features/onboarding/setupFixtures'
import RangeCard from '@/features/onboarding/setup/RangeCard.vue'
import { RulesProvider } from '@/features/assistant/RulesProvider'
import { contextFor, plannerWithBlocks } from '@/features/assistant/testSupport'
import { configurePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId } from '@/repositories/testSupport'
import { formatDuration, setHourCycle } from '@/ui/format'
import { i18n, SUPPORTED_LOCALES } from './index'

// verify4 defect 14, one pattern per test, every language: "monday to Friday", "Añade unos 1 h",
// "0 min left unscheduled" and "p. m.." where a sentence ends with a 12-hour time.
const t = (locale: string, key: string, params: Record<string, unknown> = {}) => {
  i18n.global.locale.value = locale as typeof i18n.global.locale.value
  return i18n.global.t(key, params)
}

afterEach(() => {
  setHourCycle('auto')
  i18n.global.locale.value = 'en'
  document.body.innerHTML = ''
})

describe.each([...SUPPORTED_LOCALES])('copy in %s', (locale) => {
  it('a range of weekdays keeps the case its language writes weekday names in', () => {
    const labels = {
      weekdays: t(locale, 'onboarding.guided.days.weekdays'), everyDay: t(locale, 'onboarding.guided.days.everyDay'),
      weekend: t(locale, 'onboarding.guided.days.weekend'), everyNight: t(locale, 'onboarding.guided.days.everyNight'),
    }
    const phrase = daysPhrase([1, 2, 3, 4, 5], locale, 1, labels)
    const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long', timeZone: 'UTC' })
    const names = Array.from({ length: 7 }, (_, day) => weekday.format(Date.UTC(2024, 0, 7 + day)))
    for (const word of phrase.split(/[\s,]+/)) {
      const name = names.find((candidate) => candidate.toLocaleLowerCase(locale) === word.toLocaleLowerCase(locale))
      if (name) expect(word, phrase).toBe(name)
    }
    expect({ en: 'Monday to Friday', es: 'lunes a viernes', fr: 'lundi à vendredi', pt: 'segunda a sexta', de: 'Montag bis Freitag' }[locale]).toBe(phrase)
  })

  it('the hint for a task that does not fit reads right with an amount of one', () => {
    const hint = t(locale, 'tasks.overflowHint', { duration: formatDuration(60, locale), category: 'X' })
    expect(hint).toContain('1 h')
    expect(hint).not.toMatch(/\b(unos|unas|uns|umas|quelques|einige|some|several)\s+1\b/iu)
  })

  it('tasks that are only late leave no "0 min left unscheduled"', async () => {
    const document = plannerWithBlocks()
    document.tasks.push({ id: 't1', title: 'Write report', categoryId: 'work', durationMin: 30, priority: 1, createdAt: '2026-10-20T08:00:00Z', dueDate: '2026-10-23' })
    const question = { en: 'Which tasks do not fit?', es: '¿Qué tareas no caben?', fr: 'Quelles tâches ne tiennent pas ?', pt: 'Quais tarefas não cabem?', de: 'Welche Aufgaben passen nicht?' }[locale]!
    const { answer } = await new RulesProvider().ask(question, contextFor(document, locale), new AbortController().signal)
    expect(answer).toContain('Write report')
    expect(answer).not.toMatch(/(^|\s)0\s?min/u)
  })

  it('a clash with a 12-hour time ends with one period', async () => {
    setHourCycle('h12')
    const pinia = createPinia()
    setActivePinia(pinia)
    configurePlannerStore({ repository: createTestRepositories().planner, now: fixedNow, newId: newTestId, locale: () => locale, timeZone: () => 'UTC' })
    const state = createState(documentWith(), env)
    state.answers.workStudy = 'work'
    state.answers.exercise = 'yes'
    const work = ensureCategory(state, 'work', 'work', 'Work')
    work.ranges.push({ key: 'w', days: [1], start: 20 * 60, end: 22 * 60, accepted: true, touched: true })
    const gym = ensureCategory(state, 'exercise', 'exercise', 'Gym')
    gym.ranges.push({ key: 'g', days: [1], start: 21 * 60, end: 22 * 60 + 30, accepted: true, touched: true })
    i18n.global.locale.value = locale as typeof i18n.global.locale.value
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({ render: () => h(RangeCard, { state, category: gym, range: gym.ranges[0]!, open: null }) }).use(pinia).use(i18n)
    app.mount(host)
    await nextTick()
    const text = host.textContent ?? ''
    expect(text).toContain('Work')
    expect(text, text).not.toMatch(/\.\.(?!\.)/u)
    app.unmount()
  })
})
