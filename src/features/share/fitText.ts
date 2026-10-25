// Text fitting for the share card, independent of Canvas: `measure` returns a string's advance width in points for a
// weight and size, so tests can inject a pessimistic measurer and the painter injects the real one.
export interface FontSpec { weight: number; size: number }
export type Measure = (text: string, font: FontSpec) => number

export interface FittedLine { text: string; size: number; truncated: boolean }

type GraphemeSegmenter = new (locale: undefined, options: { granularity: 'grapheme' }) => { segment(text: string): Iterable<{ segment: string }> }

export function graphemes(text: string): string[] {
  const Segmenter = (Intl as unknown as { Segmenter?: GraphemeSegmenter }).Segmenter
  if (Segmenter) return Array.from(new Segmenter(undefined, { granularity: 'grapheme' }).segment(text), ({ segment }) => segment)
  return Array.from(text)
}

const ELLIPSIS = '…'

// One line: the largest size from `size` down to `min` that fits, else `min` cut at a grapheme boundary with "…".
// The result is never wider than maxWidth (an empty string when not even "…" fits).
export function fitLine(text: string, options: { weight: number; size: number; min: number; maxWidth: number }, measure: Measure): FittedLine {
  const { weight, min, maxWidth } = options
  for (let size = options.size; size >= min; size -= 1) {
    if (measure(text, { weight, size }) <= maxWidth) return { text, size, truncated: false }
  }
  const parts = graphemes(text)
  while (parts.length > 0 && measure(parts.join('').trimEnd() + ELLIPSIS, { weight, size: min }) > maxWidth) parts.pop()
  const cut = parts.join('').trimEnd()
  const fitted = cut ? cut + ELLIPSIS : measure(ELLIPSIS, { weight, size: min }) <= maxWidth ? ELLIPSIS : ''
  return { text: fitted, size: min, truncated: true }
}

// Lines between words, never cutting a word that fits on a line of its own; a word wider than the line is broken at
// grapheme boundaries. Never ellipsizes: callers that must keep every word (the headline, the caption) use it.
export function wrapLines(text: string, font: FontSpec, maxWidth: number, measure: Measure): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word
    if (measure(candidate, font) <= maxWidth) {
      line = candidate
      continue
    }
    if (line) lines.push(line)
    line = ''
    if (measure(word, font) <= maxWidth) {
      line = word
      continue
    }
    for (const grapheme of graphemes(word)) {
      if (line && measure(line + grapheme, font) > maxWidth) {
        lines.push(line)
        line = ''
      }
      line += grapheme
    }
  }
  if (line) lines.push(line)
  return lines
}

// The largest size from `size` down to `min` at which the text wraps into at most maxLines lines; below that, `min`
// with as many lines as it takes. Every word is kept.
export function fitBlock(text: string, options: { weight: number; size: number; min: number; maxWidth: number; maxLines: number }, measure: Measure): { lines: string[]; size: number } {
  const { weight, min, maxWidth, maxLines } = options
  for (let size = options.size; size >= min; size -= 1) {
    const lines = wrapLines(text, { weight, size }, maxWidth, measure)
    if (lines.length <= maxLines) return { lines, size }
  }
  return { lines: wrapLines(text, { weight, size: min }, maxWidth, measure), size: min }
}
