import { describe, expect, it } from 'vitest'
import { EN } from './__corpus__/en'
import { ES } from './__corpus__/es'
import { PT } from './__corpus__/pt'
import { CORPUS_CLOCKS, CORPUS_TIME_ZONE, type CorpusCase } from './__corpus__/types'
import { parseCapture } from './parseCapture'

// Exact comparison, key order aside: a field the case does not list must be absent.
const canonical = (value: { title: string; fields: object }) => JSON.stringify({ title: value.title, fields: Object.fromEntries(Object.entries(value.fields).sort(([a], [b]) => a.localeCompare(b))) })

const CORPORA: [string, CorpusCase[]][] = [['es', ES], ['en', EN], ['pt', PT]]

function expected(item: CorpusCase) {
  const fields: Record<string, unknown> = {}
  if (item.dueDate !== undefined) fields.dueDate = item.dueDate
  if (item.at !== undefined) fields.at = item.at
  if (item.durationMin !== undefined) fields.durationMin = item.durationMin
  if (item.dateFromTime) fields.dateFromTime = true
  return { title: item.title, fields }
}

describe('L0 corpus (frozen before the parser, rev 2.1 §7.5)', () => {
  for (const [locale, corpus] of CORPORA) {
    it(`${locale}: at least 80 cases, 25 of them negative, and every one exact`, () => {
      expect(corpus.length).toBeGreaterThanOrEqual(80)
      expect(corpus.filter((item) => item.kind === 'negative').length).toBeGreaterThanOrEqual(25)
      const failures = corpus.flatMap((item) => {
        const parsed = parseCapture({ text: item.text, locale, now: CORPUS_CLOCKS[item.clock ?? 'mon'], timeZone: CORPUS_TIME_ZONE })
        const actual = { title: parsed.title, fields: parsed.fields }
        return canonical(actual) === canonical(expected(item)) ? [] : [{ text: item.text, expected: expected(item), actual }]
      })
      expect(failures).toEqual([])
    })
  }
})
