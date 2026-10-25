import { describe, expect, it } from 'vitest'
import { fitPieces, fittedHeight, lineCount, type TextMetrics, type TextPiece } from './itemText'

// Every character 6 px wide, every line 16 px tall.
const metrics: TextMetrics = { width: (text) => [...text].length * 6, lineHeight: () => 16 }
const piece = (text: string, lead = 0): TextPiece => ({ text, role: 'caption', lead })

describe('lineCount', () => {
  it('wraps at ordinary spaces only', () => {
    // "Vendor" is 36 px, "Vendor call" 66 px.
    expect(lineCount(piece('Vendor call'), 80, metrics)).toBe(1)
    expect(lineCount(piece('Vendor call'), 50, metrics)).toBe(2)
  })

  it('keeps a time joined by no-break spaces on one line, so a range breaks only around its dash', () => {
    const range = '9:15 a. m. – 1:00 p. m.'
    // "9:15 a. m." is 60 px: the dash joins the first line when it fits, never splitting "p. m.".
    expect(lineCount(piece(range), 80, metrics)).toBe(2)
    expect(lineCount(piece(range), 58, metrics)).toBeNull()
  })

  it('says a title cannot be drawn when one word is wider than the line, instead of cutting it', () => {
    expect(lineCount(piece('Tagesabschluss'), 60, metrics)).toBeNull()
    expect(lineCount(piece('Reunión diaria'), 30, metrics)).toBeNull()
  })

  it('counts a lead (a mark or an icon) before the first word', () => {
    expect(lineCount(piece('Gym', 20), 40, metrics)).toBe(1)
    expect(lineCount(piece('Gym', 30), 40, metrics)).toBeNull()
    expect(lineCount(piece('Gym day', 20), 45, metrics)).toBe(2)
  })

  it('has nothing to draw for an empty title', () => {
    expect(lineCount(piece('   '), 100, metrics)).toBeNull()
  })
})

describe('fitPieces', () => {
  const pieces = [piece('Deep work', 18), piece('9:15 AM – 1:00 PM'), piece('Work')]

  it('draws the pieces in order and stops at the first that does not fit whole', () => {
    expect(fitPieces(pieces, { width: 200, height: 60 }, metrics, 1)).toEqual([{ lines: 1, lead: true }, { lines: 1, lead: false }, { lines: 1, lead: false }])
    expect(fitPieces(pieces, { width: 200, height: 40 }, metrics, 1)).toHaveLength(2)
    expect(fitPieces(pieces, { width: 200, height: 16 }, metrics, 1)).toHaveLength(1)
    expect(fitPieces(pieces, { width: 200, height: 15 }, metrics, 1)).toEqual([])
  })

  it('drops the lead before it drops the title', () => {
    // With the 18 px lead "Deep work" takes two lines (72 px, then "work"); without it, one.
    expect(fitPieces(pieces, { width: 60, height: 16 }, metrics)).toEqual([{ lines: 1, lead: false }])
    expect(fitPieces(pieces, { width: 60, height: 32 }, metrics)).toEqual([{ lines: 2, lead: true }])
  })

  it('draws nothing in a box with no width', () => {
    expect(fitPieces(pieces, { width: 0, height: 100 }, metrics)).toEqual([])
  })

  it('measures what it fitted with the same gap', () => {
    const fits = fitPieces(pieces, { width: 200, height: 60 }, metrics, 1)
    expect(fittedHeight(pieces, fits, metrics, 1)).toBe(16 * 3 + 2)
  })
})
