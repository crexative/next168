import { describe, expect, it } from 'vitest'
import { INTENT_JSON_SCHEMA, intentExamples, intentSystemPrompt, parseClock, parseIntent, proposalFromIntent } from './changeIntent'
import { AssistantError } from './provider'
import { plannerWithBlocks, translatorFor } from './testSupport'

const document = plannerWithBlocks()
const environment = { request: '', document, locale: 'en', translate: translatorFor('en') }
const map = (raw: Record<string, unknown>, request = '') => proposalFromIntent(parseIntent(raw), { ...environment, request })

function ops(raw: Record<string, unknown>, request = '') {
  const outcome = map(raw, request)
  if (outcome.kind !== 'proposal') throw new Error(`expected a proposal, got: ${outcome.message}`)
  return outcome.proposal.ops
}
function message(raw: Record<string, unknown>, request = ''): string {
  const outcome = map(raw, request)
  if (outcome.kind !== 'message') throw new Error('expected a message')
  return outcome.message
}

describe('parseClock', () => {
  it.each([
    ['18:00', 1080], ['9:05', 545], ['00:00', 0], ['23:59', 1439], ['24:00', 0], ['7pm', 1140], ['7:30 AM', 450],
    ['12am', 0], ['12pm', 720], ['18.30', 1110], ['06h15', 375],
  ])('reads %s as minute %s', (text, minute) => {
    expect(parseClock(text)).toBe(minute)
  })

  it.each(['25:00', '12:60', '13pm', '0am', 'noon', '', undefined])('rejects %s', (text) => {
    expect(parseClock(text)).toBeUndefined()
  })
})

describe('add_block', () => {
  it('resolves the category by name, case-insensitively, and the weekday to a day index', () => {
    expect(ops({ intent: 'add_block', title: 'Gym', categoryName: 'wOrK', day: 'Thursday', start: '18:00', durationMinutes: 60 })).toEqual([
      { op: 'add_block', block: { categoryId: 'work', title: 'Gym', days: [4], start: 1080, end: 1140 } },
    ])
  })

  it('binds the proposal to the document and describes it in the summary', () => {
    const outcome = map({ intent: 'add_block', title: 'Work', day: 'thursday', start: '18:00', durationMinutes: 60 })
    if (outcome.kind !== 'proposal') throw new Error('expected a proposal')
    expect(outcome.proposal).toMatchObject({ contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision })
    expect(outcome.summary).toBe('Add "Work" on Thursday, 18:00–19:00')
  })

  it('reads hours and minutes, and refuses a length that is not a block', () => {
    expect(ops({ intent: 'add_block', title: 'Study', day: 'monday', start: '19:00', durationHours: 1.5 })).toMatchObject([{ block: { end: 1230 } }])
    expect(ops({ intent: 'add_block', title: 'Study', day: 'monday', start: '19:00', durationHours: 1, durationMinutes: 30 })).toMatchObject([{ block: { end: 1230 } }])
    expect(message({ intent: 'add_block', title: 'Study', day: 'monday', start: '19:00', durationMinutes: 1 })).toContain('I need more detail')
    expect(message({ intent: 'add_block', title: 'Study', day: 'monday', start: '19:00', durationHours: 30 })).toContain('I need more detail')
  })

  it('uses the title as the category when the model leaves the category out', () => {
    expect(ops({ intent: 'add_block', title: 'Study', day: 'monday', start: '19:00' })).toMatchObject([{ block: { categoryId: 'study', end: 1200 } }])
  })

  it('takes an explicit end and lets it pass midnight', () => {
    expect(ops({ intent: 'add_block', title: 'Study', day: 'friday', start: '22:00', end: '01:00' })).toMatchObject([{ block: { start: 1320, end: 60, days: [5] } }])
    expect(ops({ intent: 'add_block', title: 'Study', day: 'friday', start: '23:30', durationMinutes: 90 })).toMatchObject([{ block: { start: 1410, end: 60 } }])
  })

  it('understands null fields, numeric strings and 12-hour times from a small model', () => {
    expect(ops({ intent: 'add_block', title: 'Study', categoryName: null, day: 'MONDAY', start: '7pm', end: null, durationMinutes: '45', dueDate: null }))
      .toMatchObject([{ block: { start: 1140, end: 1185 } }])
  })

  it('names the categories that exist when the requested one does not', () => {
    expect(message({ intent: 'add_block', title: 'Gym', categoryName: 'Fitness', day: 'monday', start: '07:00' }))
      .toBe('I could not find the category "Fitness". Your categories are: Work, Study.')
  })

  it.each([
    ['no day', { intent: 'add_block', title: 'Study', start: '07:00' }],
    ['no start', { intent: 'add_block', title: 'Study', day: 'monday' }],
    ['an unreadable start', { intent: 'add_block', title: 'Study', day: 'monday', start: 'after lunch' }],
    ['an unknown day', { intent: 'add_block', title: 'Study', day: 'someday', start: '07:00' }],
    ['a zero-length block', { intent: 'add_block', title: 'Study', day: 'monday', start: '07:00', end: '07:00' }],
    ['no title', { intent: 'add_block', day: 'monday', start: '07:00' }],
  ])('asks for more detail with %s', (_label, raw) => {
    expect(message(raw)).toContain('I need more detail')
  })
})

describe('move_block and delete_block', () => {
  it('moves a block found by title and keeps its length when only the start changes', () => {
    expect(ops({ intent: 'move_block', title: 'review', day: 'thursday', start: '10:00' })).toEqual([
      { op: 'update_block', id: 'work-fri', patch: { days: [4], start: 600, end: 660 } },
    ])
  })

  it('moves one weekday of a repeating block and leaves the others', () => {
    expect(ops({ intent: 'move_block', title: 'Deep work', fromDay: 'tuesday', day: 'thursday' })).toEqual([
      { op: 'update_block', id: 'work-am', patch: { days: [1, 4, 3], start: 540, end: 780 } },
    ])
  })

  it('asks which day when a repeating block is moved without saying from where', () => {
    expect(message({ intent: 'move_block', title: 'Deep work', day: 'thursday' })).toContain('Please say which day')
  })

  it('reports a block that does not exist', () => {
    expect(message({ intent: 'move_block', title: 'Yoga', day: 'thursday' })).toBe('I could not find a block called "Yoga" in your plan.')
    expect(message({ intent: 'delete_block', title: 'Yoga' }, 'Delete Yoga')).toContain('"Yoga"')
  })

  it('deletes a block, or only one weekday of a repeating block', () => {
    expect(ops({ intent: 'delete_block', title: 'Review' }, 'Delete the Review block')).toEqual([{ op: 'delete_block', id: 'work-fri' }])
    expect(ops({ intent: 'delete_block', title: 'Deep work', day: 'tuesday' }, 'Remove Deep work on Tuesday')).toEqual([
      { op: 'update_block', id: 'work-am', patch: { days: [1, 3] } },
    ])
  })
})

describe('removal safeguard', () => {
  it('never removes anything unless the person asked to remove, whatever intent the model chose', () => {
    expect(message({ intent: 'delete_block', title: 'Review', day: 'friday' }, 'Schedule Review from 11pm to 7am on Friday')).toContain('nothing was changed')
  })

  it.each(['Delete the Review block', 'quita Review', 'Elimina el bloque Review', 'Supprime Review', 'Exclui Review', 'Lösche Review', 'please cancel Review'])('accepts "%s" as a request to remove', (request) => {
    expect(ops({ intent: 'delete_block', title: 'Review' }, request)).toEqual([{ op: 'delete_block', id: 'work-fri' }])
  })
})

describe('add_task', () => {
  it('creates a task with a duration kept within the allowed range and a valid due date only', () => {
    expect(ops({ intent: 'add_task', title: 'Pay rent', categoryName: 'work', durationMinutes: 5, dueDate: '2026-11-02' }, 'Add the task Pay rent in Work, due 2026-11-02')).toEqual([
      { op: 'add_task', task: { title: 'Pay rent', categoryId: 'work', durationMin: 15, priority: 2, dueDate: '2026-11-02' } },
    ])
    expect(ops({ intent: 'add_task', title: 'Plan', categoryName: 'Study', durationMinutes: 600, dueDate: 'next friday' })).toEqual([
      { op: 'add_task', task: { title: 'Plan', categoryId: 'study', durationMin: 180, priority: 2 } },
    ])
  })

  it('drops a due date the person never wrote, because the model cannot know today\'s date', () => {
    expect(ops({ intent: 'add_task', title: 'Pay rent', categoryName: 'work', dueDate: '2026-11-15' }, 'Add a task Pay rent in Work')).toEqual([
      { op: 'add_task', task: { title: 'Pay rent', categoryId: 'work', durationMin: 30, priority: 2 } },
    ])
  })

  it('needs a known category', () => {
    expect(message({ intent: 'add_task', title: 'Pay rent' })).toContain('Your categories are: Work, Study')
  })
})

describe('none and invalid replies', () => {
  it('tells the person it was not a change, with an example', () => {
    expect(message({ intent: 'none' })).toContain('Try, for example')
  })

  it('answers in the interface language', () => {
    const spanish = proposalFromIntent(parseIntent({ intent: 'add_block', title: 'Study', day: 'thursday', start: '18:00' }), { ...environment, locale: 'es', translate: translatorFor('es') })
    expect(spanish).toMatchObject({ kind: 'proposal', summary: 'Añadir "Study" el jueves, 18:00–19:00' })
  })

  it.each([
    ['an unknown intent', { intent: 'format_disk' }],
    ['no intent', { title: 'x' }],
    ['a non-text title', { intent: 'add_block', title: { a: 1 } }],
  ])('rejects %s as invalid-output', (_label, raw) => {
    expect(() => parseIntent(raw)).toThrow(AssistantError)
    try { parseIntent(raw) } catch (error) { expect((error as AssistantError).code).toBe('invalid-output') }
  })
})

describe('prompt and schema', () => {
  it('keeps the schema small and flat, with enumerated intents and weekdays', () => {
    expect(Object.keys(INTENT_JSON_SCHEMA.properties)).toHaveLength(10)
    expect(INTENT_JSON_SCHEMA.required).toEqual(['intent'])
    expect(INTENT_JSON_SCHEMA.properties.day.enum).toHaveLength(7)
  })

  it('gives the model few-shot examples that satisfy the schema, plus category and block names but no ids', () => {
    const prompt = intentSystemPrompt(document, 'en')
    for (const example of intentExamples(document)) {
      expect(() => parseIntent(example.reply)).not.toThrow()
      expect(prompt).toContain(example.request)
    }
    expect(prompt).toContain('Categories: Work, Study')
    expect(prompt).toContain('"categoryName":"Study"') // examples use categories that exist in the document
    expect(prompt).toContain('Deep work (mon/tue/wed 09:00-13:00)')
    expect(prompt).not.toContain('work-am')
    expect(prompt).not.toContain(document.workspaceId)
  })
})
