import { describe, expect, it } from 'vitest'
import { ELLIPSIS, fitPieces, fitTitle, fittedHeight, lineCount, type TextMetrics, type TextPiece } from './itemText'

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

describe('fitTitle', () => {
  const title = (text: string, lead = 0): TextPiece => ({ text, role: 'caption', lead })

  it('draws the whole title on as many lines as it needs', () => {
    expect(fitTitle(title('Revisión de diseño'), { width: 70, height: 32 }, metrics)).toEqual({ text: 'Revisión de diseño', lines: 2, lead: false, truncated: false })
  })

  it('keeps every whole word that fits and ends with "…" after the last one', () => {
    // 70 px lines (69 to spare): "Revisión de" is 66 px, "diseño de" 54, "producto" would need a third line.
    expect(fitTitle(title('Revisión de diseño de producto'), { width: 70, height: 32 }, metrics)).toEqual({ text: `Revisión de diseño de${ELLIPSIS}`, lines: 2, lead: false, truncated: true })
    // One line: "Revisión de" leaves no room for "…", so the line ends after "Revisión".
    expect(fitTitle(title('Revisión de diseño de producto'), { width: 70, height: 16 }, metrics)!.text).toBe(`Revisión${ELLIPSIS}`)
  })

  it('never cuts a word: when not even the first word and "…" fit, there is no title', () => {
    expect(fitTitle(title('Vendor call'), { width: 40, height: 16 }, metrics)).toBeNull()
    expect(fitTitle(title('Tagesabschluss'), { width: 60, height: 100 }, metrics)).toBeNull()
    expect(fitTitle(title('Vendor call'), { width: 100, height: 15 }, metrics)).toBeNull()
  })

  it('prefers the whole title without its lead over a cut one with it', () => {
    expect(fitTitle(title('Vendor call', 20), { width: 70, height: 16 }, metrics)).toMatchObject({ text: 'Vendor call', lead: false })
    expect(fitTitle(title('Vendor call', 20), { width: 90, height: 16 }, metrics)).toMatchObject({ text: 'Vendor call', lead: true })
  })
})

describe('a first word longer than a line', () => {
  // The browser hyphenates "Revisión…" into two lines of 40 px and cannot break "Xyzzyplugh".
  const hyphenating: TextMetrics = { ...metrics, hyphenatedLines: (text, _role, width) => text.startsWith('Revisión') && width >= 30 ? 2 : null }

  it('is hyphenated by the browser, alone and followed by "…", when its lines fit', () => {
    expect(fitTitle({ text: 'Revisión de diseño', role: 'caption' }, { width: 41, height: 32 }, hyphenating)).toEqual({ text: `Revisión${ELLIPSIS}`, lines: 2, lead: false, truncated: true, hyphenated: true })
  })

  it('makes the box a mark when its hyphenated lines do not fit, or the browser cannot break it', () => {
    expect(fitTitle({ text: 'Revisión de diseño', role: 'caption' }, { width: 41, height: 16 }, hyphenating)).toBeNull()
    expect(fitTitle({ text: 'Xyzzyplugh', role: 'caption' }, { width: 41, height: 48 }, hyphenating)).toBeNull()
  })

  it('is never hyphenated when it fits a line whole', () => {
    const fit = fitTitle({ text: 'Revisión de diseño', role: 'caption' }, { width: 70, height: 16 }, hyphenating)
    expect(fit).toMatchObject({ text: `Revisión${ELLIPSIS}` })
    expect(fit?.hyphenated).toBeFalsy()
  })
})

// verify6 D1/D2: boxes with room for a word were left blank.
describe('a word that fits is drawn', () => {
  it('fits a word and "…" with a quarter pixel to spare, not a whole pixel ("Correos…" 62.2 px in 62.5 px)', () => {
    // "Correos" 42 px + "…" 6 px = 48 px.
    expect(fitTitle({ text: 'Correos y seguimiento', role: 'caption' }, { width: 48.3, height: 16 }, metrics)).toMatchObject({ text: `Correos${ELLIPSIS}`, truncated: true })
  })

  it('measures the last word together with its "…", as the browser shapes them ("Pagar…" is narrower than the sum)', () => {
    const shaped: TextMetrics = { ...metrics, width: (text, role) => text === `Pagar${ELLIPSIS}` ? 33 : metrics.width(text, role) }
    // "Pagar" (30 px) plus "…" (6 px) is 36 px; the pair is drawn in 33 px and fits 34 px.
    expect(fitTitle({ text: 'Pagar la luz', role: 'caption' }, { width: 34, height: 16 }, shaped)).toMatchObject({ text: `Pagar${ELLIPSIS}` })
  })

  // verify7: syllables ("Pre-pa-rar…") read as choppy; a word that fits a line keeps it, and "…" takes the next one.
  it('keeps a first word that fits a line on its own and puts "…" on the next line, rather than hyphenating it', () => {
    const hyphenating: TextMetrics = { ...metrics, hyphenatedLines: (text) => text.startsWith('Preparar') ? 2 : null }
    // "Preparar" is 48 px and fits 50 px; "Preparar…" (54 px) does not.
    expect(fitTitle({ text: 'Preparar presentación', role: 'caption' }, { width: 50, height: 32 }, hyphenating)).toEqual({ text: `Preparar ${ELLIPSIS}`, lines: 2, lead: false, truncated: true })
    // One line only: neither stacking nor hyphenation fits.
    expect(fitTitle({ text: 'Preparar presentación', role: 'caption' }, { width: 50, height: 16 }, hyphenating)).toBeNull()
  })

  it('hyphenates only a first word that fits no line at all ("Prepa-" / "rar…")', () => {
    const hyphenating: TextMetrics = { ...metrics, hyphenatedLines: (text) => text.startsWith('Preparar') ? 2 : null }
    expect(fitTitle({ text: 'Preparar presentación', role: 'caption' }, { width: 45, height: 32 }, hyphenating)).toEqual({ text: `Preparar${ELLIPSIS}`, lines: 2, lead: false, truncated: true, hyphenated: true })
  })
})
