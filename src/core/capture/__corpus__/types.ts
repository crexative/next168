// The frozen L0 capture corpus (tasks design rev 2.1 §7.5, rev 3 §2.1, rev 6 §2.1). It was written and committed before
// the parser existed; the parser must reproduce every case exactly. Never edit an existing case to make the parser
// pass: a changed expectation is a design decision and goes through review.
//
// Reference clocks, America/Bogota (UTC-5, no DST):
// - 'mon': Monday 2026-10-26 08:02 (the default);
// - 'sun': Sunday 2026-10-25 08:00 (the rev 2.1 §7.4 examples).
export const CORPUS_TIME_ZONE = 'America/Bogota'
export const CORPUS_CLOCKS = {
  mon: new Date('2026-10-26T13:02:00.000Z'),
  sun: new Date('2026-10-25T13:00:00.000Z'),
} as const

export interface CorpusCase {
  text: string
  clock?: keyof typeof CORPUS_CLOCKS
  // positive: fields are extracted; negative: nothing is extracted (the title is the whole text); attack: the red-team
  // R10 table (redteam.md), verbatim, with its required result.
  kind: 'positive' | 'negative' | 'attack'
  title: string
  dueDate?: string
  at?: number
  durationMin?: number
  dateFromTime?: true
}
