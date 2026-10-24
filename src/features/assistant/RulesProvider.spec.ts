import { describe, expect, it } from 'vitest'
import { computeStats } from '@/core/stats'
import { freeHoursAhead } from '@/features/capacity/freeHours'
import { formatDuration, type AssistantProvider } from './provider'
import { RulesProvider } from './RulesProvider'
import { contextFor, plannerWithBlocks } from './testSupport'

const rules: AssistantProvider = new RulesProvider()
const signal = new AbortController().signal
const ask = (question: string, locale = 'en', document = plannerWithBlocks()) => rules.ask(question, contextFor(document, locale), signal)

describe('RulesProvider', () => {
  it('is always available and needs no preparation', async () => {
    expect(await rules.availability()).toBe('available')
    await expect(rules.prepare(() => undefined, signal)).resolves.toBeUndefined()
  })

  it('answers hours of a category with the computed total', async () => {
    const document = plannerWithBlocks()
    const work = computeStats(document).categories.find((entry) => entry.categoryId === 'work')!
    const { answer } = await ask('How many hours of work this week?')
    expect(work.plannedMinutes).toBe(13 * 60)
    expect(answer).toContain(formatDuration(work.plannedMinutes))
    expect(answer).toBe('Work: 13 h planned this week.')
  })

  it('lists every category and the total when no category is named', async () => {
    const { answer } = await ask('How many hours did I plan?')
    expect(answer).toContain('15 h planned this week out of 168 h.')
    expect(answer).toContain('Work: 13 h')
    expect(answer).toContain('Study')
  })

  it('answers what is left to a max limit and what is missing to a min goal', async () => {
    expect((await ask('How much is left for work?')).answer).toBe('Work: 13 h planned of the 40 h limit, 27 h left.')
    expect((await ask('What remains to reach my study goal?')).answer).toBe('Study: 2 h planned, 3 h still needed to reach the 5 h goal.')
  })

  it('answers free hours from now through the same split as the badge, then the routine\'s unassigned hours', async () => {
    const stats = computeStats(plannerWithBlocks())
    const { answer } = await ask('How many unassigned hours do I have?')
    expect(answer).toContain(formatDuration(stats.unassignedHours * 60))
    // Saturday 12:00: 132 h of the week have passed and no block is left before Monday.
    expect(answer).toBe('36 h free from now to Sunday (132 h already past, 0 h planned ahead). Your routine leaves 153 h of the 168 h unassigned (15 h planned).')
  })

  it('counts free hours from now, not the whole week, mid-week', async () => {
    const document = plannerWithBlocks()
    const wednesday = new Date('2026-10-21T10:00:00Z')
    const { answer } = await rules.ask('How many free hours do I have this week?', contextFor(document, 'es', wednesday), signal)
    expect(answer).toBe(`Quedan ${Math.round(freeHoursAhead(document, wednesday, 'UTC'))} h libres de aquí al domingo (58 h ya pasaron y 4 h están planificadas por delante). Tu rutina deja 153 h de las 168 h sin asignar (15 h planificadas).`)
    expect(freeHoursAhead(document, wednesday, 'UTC')).toBe(106)
  })

  it('rounds free hours to whole hours like the badge (36 h 18 min reads "36 h")', async () => {
    const saturday = new Date('2026-10-24T11:42:00Z') // 36 h 18 min to Monday 00:00
    const { answer } = await rules.ask('How many free hours do I have this week?', contextFor(plannerWithBlocks(), 'en', saturday), signal)
    expect(answer).toMatch(/^36 h free from now to Sunday \(132 h already past, 0 h planned ahead\)/)
  })

  it('answers the next block', async () => {
    const { answer } = await ask("What's my next block?")
    // A readable date, never an ISO one, and the time in the shared clock format.
    expect(answer).toMatch(/^Next: Deep work on Monday, October 26 at \d{1,2}:\d{2}( [AP]M)?\.$/)
    expect(answer).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('answers which tasks overflow', async () => {
    const document = plannerWithBlocks()
    expect((await ask('Which tasks do not fit?', 'en', document)).answer).toBe('All unfinished tasks fit in your free time.')
    document.tasks.push({ id: 't1', title: 'Write report', categoryId: 'work', durationMin: 180, priority: 1, createdAt: '2026-10-24T08:00:00Z', dueDate: '2026-10-24' })
    const { answer } = await ask('Which tasks do not fit?', 'en', document)
    expect(answer).toContain('Write report')
  })

  it.each([
    ['es', 'Cuántas horas de work tengo esta semana?', 'Work: 13 h planificadas esta semana.'],
    ['fr', 'Combien d’heures de work cette semaine ?', 'Work : 13 h planifiées cette semaine.'],
    ['pt', 'Quantas horas de work nesta semana?', 'Work: 13 h planejadas nesta semana.'],
    ['de', 'Wie viele Stunden work diese Woche?', 'Work: 13 h diese Woche geplant.'],
  ])('understands %s questions and answers in that locale', async (locale, question, expected) => {
    expect((await ask(question, locale)).answer).toBe(expected)
  })

  it('matches intents written in another locale than the interface', async () => {
    expect((await ask('¿Cuántas horas libres tengo?', 'en')).answer).toContain('153 h')
  })

  it('says it cannot change the plan and never proposes', async () => {
    const reply = await ask('Add a gym block on Monday')
    expect(reply.proposal).toBeUndefined()
    expect(reply.answer).toContain('on-device model')
  })

  it('lists what it can answer for an unknown question', async () => {
    expect((await ask('Tell me a joke')).answer).toContain('next block')
  })

  it('does not tell the user to turn on a model this device cannot run', async () => {
    const document = plannerWithBlocks()
    const turnOn = await rules.ask('Add a gym block on Thursday', contextFor(document), signal)
    expect(turnOn.answer).toContain('Turn it on in Settings')
    const unavailable = await rules.ask('Add a gym block on Thursday', { ...contextFor(document), modelAvailability: 'unavailable' }, signal)
    expect(unavailable.answer).not.toMatch(/turn it on/i)
    expect(unavailable.answer).toContain('cannot run')
  })
})
