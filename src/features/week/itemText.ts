// What text an item of the week grid can draw whole in its box (docs/design/visual-design.md › Week items).
// Text is either complete, wrapped between words, or not drawn: never an ellipsis, a cut word or a cut line.

export type TextRole = 'blockTitle' | 'blockDetail' | 'caption' | 'taskTitle'

// Widths and line heights of the page's own fonts, at the current text size and language.
export interface TextMetrics {
  width(text: string, role: TextRole): number
  lineHeight(role: TextRole): number
}

export interface TextPiece {
  text: string
  role: TextRole
  // Room taken before the first word on the first line (a category mark or an icon with its space), in px.
  lead?: number
}

export interface PieceFit {
  lines: number
  // Whether the lead is drawn; it is dropped when only the words fit.
  lead: boolean
}

// Rendered line widths carry sub-pixel rounding; a line is only said to fit with this much to spare.
const SPARE_PX = 1

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
      if (lines === null) continue
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
