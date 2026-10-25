// What text an item of the week grid can draw in its box (docs/design/visual-design.md › Week items). A title shows
// whole words, wrapped between words, followed by "…" when later words did not fit; other text is whole or not drawn.
// Never a cut word ("Reunió…") and never a line cut by its box.

// `compact` is the small caption size (11 px at 100 % text, scaling with it) a title falls back to before its box
// becomes a mark: a 20-minute routine still reads "Desayuno…".
export type TextRole = 'blockTitle' | 'blockDetail' | 'caption' | 'taskTitle' | 'compact'

// Widths and line heights of the page's own fonts, at the current text size and language.
export interface TextMetrics {
  width(text: string, role: TextRole): number
  lineHeight(role: TextRole): number
  // Lines `text` takes at `width` px when the browser hyphenates it in the page's language, or null when it still runs
  // past the line (no hyphenation point, or no dictionary for the language).
  hyphenatedLines?(text: string, role: TextRole, width: number): number | null
}

export interface TextPiece {
  text: string
  role: TextRole
  // Room taken before the first word on the first line (a category mark or an icon with its space), in px.
  lead?: number
  // At most this many lines: a time range is drawn on one line or not at all.
  maxLines?: number
}

export interface PieceFit {
  lines: number
  // Whether the lead is drawn; it is dropped when only the words fit.
  lead: boolean
}

// Text and boxes are both laid out in 1/64 px units and measured on the page, so a line fits with a quarter pixel to
// spare (a whole pixel left "Correos…", 62.2 px, out of a 62.5 px box).
const SPARE_PX = 0.25

// Lines `text` needs at `width` px when it breaks only at ordinary spaces (no-break spaces keep a time together),
// or null when a word, or the lead and the first word, cannot fit on one line.
export function lineCount(piece: TextPiece, width: number, metrics: TextMetrics): number | null {
  const words = piece.text.split(' ').filter(Boolean)
  if (words.length === 0) return null
  const room = width - SPARE_PX
  const space = metrics.width(' ', piece.role)
  let lines = 1
  let used = piece.lead ?? 0
  for (const [index, word] of words.entries()) {
    const size = metrics.width(word, piece.role)
    if (index === 0) {
      if (used + size > room) return null
      used += size
    } else if (used + space + size <= room) {
      used += space + size
    } else {
      if (size > room) return null
      lines += 1
      used = size
    }
  }
  return lines
}

// The first pieces, in order, that fit a box of `width` × `height` px together, `gap` px apart. A piece that does not
// fit ends the list: later pieces are less important (title, then time, then category, then status).
export function fitPieces(pieces: readonly TextPiece[], box: { width: number; height: number }, metrics: TextMetrics, gap = 0): PieceFit[] {
  const fits: PieceFit[] = []
  let used = 0
  for (const piece of pieces) {
    const options = piece.lead ? [piece, { ...piece, lead: 0 }] : [piece]
    let fit: PieceFit | undefined
    for (const option of options) {
      const lines = box.width > 0 ? lineCount(option, box.width, metrics) : null
      if (lines === null || lines > (piece.maxLines ?? Infinity)) continue
      const height = lines * metrics.lineHeight(piece.role) + (fits.length > 0 ? gap : 0)
      if (used + height <= box.height + 0.01) {
        fit = { lines, lead: Boolean(option.lead) }
        used += height
        break
      }
    }
    if (!fit) break
    fits.push(fit)
  }
  return fits
}

// The height `fits` take, with the same gap fitPieces counted.
export function fittedHeight(pieces: readonly TextPiece[], fits: readonly PieceFit[], metrics: TextMetrics, gap = 0): number {
  return fits.reduce((sum, fit, index) => sum + fit.lines * metrics.lineHeight(pieces[index]!.role) + (index > 0 ? gap : 0), 0)
}

export const ELLIPSIS = '\u2026'

export interface TitleFit {
  // The words drawn: the whole title, or its first whole words followed by "…".
  text: string
  lines: number
  lead: boolean
  truncated: boolean
  // A first word too long for a line, hyphenated by the browser in the page's language.
  hyphenated?: boolean
}

// The title in at most `maxLines` lines of `width` px, with or without its lead: every word that fits, in order, and
// "…" right after the last one when the rest does not fit. Null when not even the first word (with "…" if more
// follow) fits a line.
function titleWith(text: string, role: TextRole, lead: number, width: number, maxLines: number, metrics: TextMetrics): TitleFit | null {
  const words = text.split(' ').filter(Boolean)
  if (words.length === 0 || maxLines < 1) return null
  const room = width - SPARE_PX
  const space = metrics.width(' ', role)
  // Each placed word with the width its line has used once it is placed.
  const placed: { word: string; line: number; end: number }[] = []
  let line = 0
  let used = lead
  for (const word of words) {
    const size = metrics.width(word, role)
    const first = placed.length === 0 || placed[placed.length - 1]!.line !== line
    if (!first && used + space + size <= room) {
      used += space + size
    } else if (first && used + size <= room) {
      used += size
    } else if (!first && size <= room && line + 1 < maxLines) {
      line += 1
      used = size
    } else {
      break
    }
    placed.push({ word, line, end: used })
  }
  if (placed.length === 0) return lead > 0 ? null : hyphenatedFirstWord(words, role, room, maxLines, metrics)
  if (placed.length === words.length) return { text, lines: line + 1, lead: lead > 0, truncated: false }
  // Words were left out: the last line ends with "…", dropping words until it fits.
  // The browser shapes "…" with the word before it ("Pagar…" is narrower than "Pagar" plus "…"), so the pair is measured.
  const endWithEllipsis = (item: { word: string; end: number }) => item.end - metrics.width(item.word, role) + metrics.width(item.word + ELLIPSIS, role)
  while (placed.length > 0 && endWithEllipsis(placed[placed.length - 1]!) > room) placed.pop()
  if (placed.length === 0) {
    // The first word fits a line but not with its "…": whole words stacked read better than syllables, so the word keeps
    // its line and "…" takes the next one when there is one ("Preparar" / "…"). Only a word that fits no line at all is
    // hyphenated.
    const first = metrics.width(words[0]!, role)
    if (lead === 0 && first <= room && maxLines >= 2 && metrics.width(ELLIPSIS, role) <= room) {
      return { text: `${words[0]} ${ELLIPSIS}`, lines: 2, lead: false, truncated: true }
    }
    return lead > 0 ? null : hyphenatedFirstWord(words, role, room, maxLines, metrics)
  }
  return { text: placed.map((item) => item.word).join(' ') + ELLIPSIS, lines: placed[placed.length - 1]!.line + 1, lead: lead > 0, truncated: true }
}

// A first word wider than a line: the browser may hyphenate it in the page's language ("Revi-" / "sión…"). It is drawn
// alone (with "…" when more words follow) if its hyphenated lines fit.
function hyphenatedFirstWord(words: readonly string[], role: TextRole, room: number, maxLines: number, metrics: TextMetrics): TitleFit | null {
  if (!metrics.hyphenatedLines) return null
  const text = words.length > 1 ? words[0]! + ELLIPSIS : words[0]!
  const lines = metrics.hyphenatedLines(text, role, room)
  if (lines === null || lines > maxLines) return null
  return { text, lines, lead: false, truncated: words.length > 1, hyphenated: true }
}

// The best title a box can draw: whole with its lead, whole without it, else the one that keeps the most words.
export function fitTitle(piece: TextPiece, box: { width: number; height: number }, metrics: TextMetrics): TitleFit | null {
  const maxLines = Math.floor((box.height + 0.01) / metrics.lineHeight(piece.role))
  if (box.width <= 0 || maxLines < 1) return null
  const options = (piece.lead ? [piece.lead, 0] : [0]).map((lead) => titleWith(piece.text, piece.role, lead, box.width, maxLines, metrics))
  const whole = options.find((option) => option && !option.truncated)
  if (whole) return whole
  return options.reduce<TitleFit | null>((best, option) => option && (!best || option.text.length > best.text.length) ? option : best, null)
}
