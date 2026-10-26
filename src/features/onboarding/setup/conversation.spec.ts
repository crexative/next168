import { beforeAll, describe, expect, it } from 'vitest'
import { i18n } from '@/i18n'
import {
  addOwnCategory, emptyState, finishMore, pick, prepareScreen, setAnswer, type ScreenId, type SetupState, type Tri, type WorkStudy,
} from '../setupModel'
import { env } from '../setupFixtures'
import { answer, extraReply, hint, question, roundReplies, summaryRows, transcript, weekIsEmpty, type Line, type Speaker } from './conversation'

// The conversation's words: each follow-up phrased from what the person said before, the defaults it offers from
// those answers, and the answer as the person would say it. Spanish, the owner's normative copy.
const t = (key: string, params?: Record<string, unknown>) => i18n.global.t(key, params ?? {})
const speaker: Speaker = { t, rangeLine: (_category, range) => `${range.days.join(',')} ${range.start}-${range.end}` }
const say = (line: Line | undefined) => (line ? t(line.key, line.params ?? {}) : undefined)

beforeAll(() => { i18n.global.locale.value = 'es' })

function walked(workStudy: WorkStudy, commute: Tri = 'unanswered'): SetupState {
  const state = emptyState()
  setAnswer(state, 'sleep', 'yes')
  setAnswer(state, 'workStudy', workStudy)
  setAnswer(state, 'commute', commute)
  for (const screen of ['sleep', 'work', 'study'] as ScreenId[]) prepareScreen(state, screen, env)
  return state
}

describe('follow-ups phrased from the earlier answers', () => {
  it.each([
    ['work', '¿Te toma tiempo ir al trabajo y volver?', '¿Cuándo vas al trabajo y cuándo vuelves?'],
    ['study', '¿Te toma tiempo ir a clase y volver?', '¿Cuándo vas a clase y cuándo vuelves?'],
    ['both', '¿Te toma tiempo ir al trabajo o a clase?', '¿Cuándo vas y cuándo vuelves?'],
  ] as const)('after "%s", the trip questions name where the person goes', (workStudy, commute, ranges) => {
    const state = walked(workStudy, 'yes')
    expect(say(question(state, 'commute'))).toBe(commute)
    expect(say(question(state, 'commuteRanges'))).toBe(ranges)
  })

  it('asks "and when do you study?" only after "both"', () => {
    expect(say(question(walked('both'), 'study'))).toBe('¿Y cuándo estudias?')
    expect(say(question(walked('study'), 'study'))).toBe('¿Cuándo estudias?')
  })

  it('says the trip times come from the hours just given, and only when they do', () => {
    const state = walked('work', 'yes')
    expect(say(hint(state, 'commuteRanges'))).toBe('Lo pusimos según tu horario. Cámbialo si no es así.')
    expect(hint(walked('neither', 'yes'), 'commuteRanges')).toBeUndefined()
  })

  it('names the person\'s own thing in its question', () => {
    const state = emptyState()
    const { category } = addOwnCategory(state, 'Clases de natación')
    expect(say(question(state, `extra:${category.key}`))).toBe('¿Cuándo es «Clases de natación»?')
  })

  it('the summary says when the week is still empty', () => {
    const state = emptyState()
    expect(weekIsEmpty(state)).toBe(true)
    expect(say(question(state, 'summary'))).toBe('Aún no hay nada. Puedes añadir algo o empezar así.')
    const working = walked('work')
    expect(summaryRows(working).map((row) => row.category.key)).toEqual(['sleep', 'work'])
    expect(say(question(working, 'summary'))).toBe('Así queda tu semana. Toca algo para cambiarlo.')
  })
})

describe('defaults offered from the earlier answers', () => {
  it('Mon–Fri 9:00–5:00 at work: going 8:30–9:00 and coming back 5:00–5:30, already chosen', () => {
    const state = walked('work', 'yes')
    prepareScreen(state, 'commuteRanges', env)
    const commute = state.categories.find((category) => category.key === 'commute')!
    expect(commute.ranges.map(({ label, days, start, end }) => ({ label, days, start, end }))).toEqual([
      { label: 'there', days: [1, 2, 3, 4, 5], start: 510, end: 540 },
      { label: 'back', days: [1, 2, 3, 4, 5], start: 1020, end: 1050 },
    ])
  })

  it('a later work start moves the suggested trip with it', () => {
    const state = walked('work', 'yes')
    state.categories.find((category) => category.key === 'work')!.ranges[0]!.start = 600
    prepareScreen(state, 'commuteRanges', env)
    expect(state.categories.find((category) => category.key === 'commute')!.ranges[0]).toMatchObject({ start: 570, end: 600 })
  })

  it('studying next to a job is suggested in the evening, clear of work', () => {
    const state = walked('both')
    expect(state.categories.find((category) => category.key === 'study')!.ranges[0]).toMatchObject({ days: [1, 2, 3, 4], start: 1140, end: 1260 })
  })
})

describe('the answer, as the person would say it', () => {
  it('skipping, yes and no, and the option chosen', () => {
    const state = emptyState()
    expect(answer(state, 'sleep', speaker)).toBe('Lo veo después')
    expect(answer(state, 'workStudy', speaker)).toBe('Lo veo después')
    setAnswer(state, 'workStudy', 'both')
    setAnswer(state, 'commute', 'yes')
    setAnswer(state, 'exercise', 'no')
    expect(answer(state, 'workStudy', speaker)).toBe('Las dos cosas')
    expect(answer(state, 'commute', speaker)).toBe('Sí')
    expect(answer(state, 'exercise', speaker)).toBe('No')
  })

  it('the times kept, one line per range, with Ida and Vuelta named; none is "Sin horario fijo"', () => {
    const state = walked('work', 'yes')
    prepareScreen(state, 'commuteRanges', env)
    expect(answer(state, 'commuteRanges', speaker)).toBe('Ida: 1,2,3,4,5 510-540\nVuelta: 1,2,3,4,5 1020-1050')
    state.categories.find((category) => category.key === 'work')!.ranges = []
    expect(answer(state, 'work', speaker)).toBe('Sin horario fijo')
  })

  it('starts a range line with a capital, as a reply on its own', () => {
    const state = walked('work')
    const lower: Speaker = { t, rangeLine: () => 'lunes a viernes · 9:00 a. m.–5:00 p. m.' }
    expect(answer(state, 'work', lower)).toBe('Lunes a viernes · 9:00 a. m.–5:00 p. m.')
  })

  it('what else: each round answers with its pick, the way out reads "Nada más" or "No, eso es todo", skipped when not answered', () => {
    const state = emptyState()
    expect(answer(state, 'more', speaker)).toBe('Lo veo después')
    pick(state, 0, 'family', env)
    pick(state, 1, addOwnCategory(state, 'Ajedrez').category.key, env)
    expect([answer(state, 'more', speaker), answer(state, 'more:1', speaker)]).toEqual(['Familia', 'Ajedrez'])
    finishMore(state, 2)
    expect(answer(state, 'more:2', speaker)).toBe('No, eso es todo')
    finishMore(state, 0)
    expect(answer(state, 'more', speaker)).toBe('Nada más')
  })

  it('asks "¿Algo más?" from the second round on, with its own hint', () => {
    const state = emptyState()
    pick(state, 0, 'family', env)
    expect([say(question(state, 'more')), say(hint(state, 'more'))]).toEqual(['¿A qué más le dedicas tiempo cada semana?', 'Elige una.'])
    expect([say(question(state, 'more:1')), say(hint(state, 'more:1'))]).toEqual(['¿Algo más?', 'Elige otra, o dime que eso es todo.'])
  })

  it('offers what is not picked yet, the round\'s own answer as current, and the way out', () => {
    const state = emptyState()
    pick(state, 0, 'family', env)
    pick(state, 1, addOwnCategory(state, 'Ajedrez').category.key, env)
    const labels = (round: number) => roundReplies(state, round, speaker).options.map((option) => option.label)
    expect(labels(0)).toEqual(['Familia', 'Amigos', 'Tiempo para ti', 'Aprender'])
    expect(labels(2)).toEqual(['Amigos', 'Tiempo para ti', 'Aprender'])
    expect(roundReplies(state, 1, speaker)).toMatchObject({ current: 'custom:1', done: { label: 'No, eso es todo', current: false } })
    finishMore(state, 2)
    expect(roundReplies(state, 2, speaker)).toMatchObject({ current: undefined, done: { current: true } })
  })
})

describe('the extra reply beside the answers: a skip or an answer', () => {
  // The owner (2026-10-25): "Lo veo después" is plain text, so people do not skip; "Sin horario fijo" is a real answer.
  it('skipping is offered as a quiet skip on the yes/no, choice and sleep questions', () => {
    const state = walked('both', 'yes')
    pick(state, 0, 'family', env)
    for (const screen of ['sleep', 'workStudy', 'commute', 'exercise', 'more'] as ScreenId[]) {
      const reply = extraReply(state, screen)
      expect(reply?.kind, screen).toBe('skip')
      expect(say(reply), screen).toBe('Lo veo después')
    }
  })

  it('"Sin horario fijo" on the other time questions is an answer, drawn like one', () => {
    const state = walked('both', 'yes')
    prepareScreen(state, 'commuteRanges', env)
    prepareScreen(state, 'exerciseRanges', env)
    pick(state, 0, 'family', env)
    for (const screen of ['work', 'study', 'commuteRanges', 'exerciseRanges', 'extra:family'] as ScreenId[]) {
      const reply = extraReply(state, screen)
      expect(reply?.kind, screen).toBe('answer')
      expect(say(reply), screen).toBe('Sin horario fijo')
    }
  })

  it('the summary and the later rounds of "¿Algo más?" offer neither (their way out is one of the replies)', () => {
    const state = walked('work')
    pick(state, 0, 'family', env)
    expect(extraReply(state, 'summary')).toBeUndefined()
    expect(extraReply(state, 'more:1')).toBeUndefined()
  })
})

describe('which exchanges stay on screen', () => {
  it('every earlier screen of the current sequence, so a changed answer drops the questions that no longer apply', () => {
    const state = walked('both', 'yes')
    state.screen = 'exercise'
    expect(transcript(state, false)).toEqual(['sleep', 'workStudy', 'work', 'study', 'commute', 'commuteRanges'])
    setAnswer(state, 'workStudy', 'neither')
    expect(transcript(state, false)).toEqual(['sleep', 'workStudy'])
    // The dormant answers come back with the answer that asked for them.
    setAnswer(state, 'workStudy', 'both')
    expect(transcript(state, false)).toEqual(['sleep', 'workStudy', 'work', 'study', 'commute', 'commuteRanges'])
  })

  it('a setup opened at the summary of an existing week, with nothing answered, has no conversation behind it', () => {
    const state = emptyState()
    state.screen = 'summary'
    expect(transcript(state, true)).toEqual([])
    expect(transcript(state, false)).toEqual(['sleep', 'workStudy', 'exercise', 'more'])
    setAnswer(state, 'exercise', 'no')
    expect(transcript(state, true)).toEqual(['sleep', 'workStudy', 'exercise', 'more'])
  })
})
