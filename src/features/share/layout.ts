import { contrast, rgb } from '@/ui/contrast'
import { cellsFor, FREE_CELL } from './cells'
import { fitBlock, fitLine, type FontSpec, type Measure } from './fitText'
import type { SharePalette } from './palette'
import { isOthers, shareGroups, showsNames, type ShareColor, type ShareGroup, type ShareSummary } from './shareSummary'

export type ShareFormat = 'story' | 'square'

// Points at 1x on a 360 pt wide frame, drawn at 3x (1080 px), like an @3x phone screen.
export const CARD_SCALE = 3
export const CARD_FORMATS: Record<ShareFormat, { width: number; height: number; safeTop: number; safeBottom: number; columns: number }> = {
  story: { width: 360, height: 640, safeTop: 90, safeBottom: 90, columns: 21 },
  square: { width: 360, height: 360, safeTop: 24, safeBottom: 24, columns: 28 },
}

const MARGIN = 24
const CELL_GAP = 2.5
const CELL_RADIUS = 0.22
const OUTLINE_WIDTH = 1
const FREE_EDGE_WIDTH = 0.5
// Below this contrast against the card a fill gets a --label-2 outline (WCAG 1.4.11, non-text contrast).
const MIN_FILL_CONTRAST = 3
// Text boxes: ascent and descent as a share of the font size, and the line pitch of wrapped text.
const ASCENT = 0.93
const DESCENT = 0.25
const LINE_PITCH = 1.2
const OTHERS_GLYPH = '+'
const RTL = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/

export interface CardCopy {
  label: string
  headline: string
  caption: string
  footer: string
  hours(minutes: number): string
  others(count: number): string
}

export interface Box { x: number; y: number; width: number; height: number }

export type TextRole = 'brand' | 'label' | 'headline' | 'caption' | 'legend-name' | 'legend-hours' | 'legend-routines' | 'glyph' | 'footer'

export type DrawOp =
  | { kind: 'background'; color: string }
  | { kind: 'rect'; role: 'cell' | 'swatch'; group: number; x: number; y: number; width: number; height: number; radius: number; fill?: string; outline?: { color: string; width: number } }
  | { kind: 'text'; role: TextRole; text: string; font: FontSpec; color: string; direction: 'ltr' | 'rtl'; baseline: number; box: Box; maxWidth: number }

export interface CardLayout {
  format: ShareFormat
  width: number
  height: number
  ops: DrawOp[]
  contentBottom: number
  footerTop: number
}

type TextOp = Extract<DrawOp, { kind: 'text' }>

function directionOf(text: string): 'ltr' | 'rtl' {
  return RTL.test(text) && !/^[\s\d]*[A-Za-zÀ-ɏ]/.test(text) ? 'rtl' : 'ltr'
}

function colorValue(color: ShareColor, palette: SharePalette): string {
  return 'hex' in color ? color.hex : palette.category[color.key]
}

// Black or white, whichever reads better on the fill, for the glyph drawn inside a cell or swatch.
function glyphColorOn(fill: string): string {
  const color = rgb(fill)
  return contrast(color, [0, 0, 0]) >= contrast(color, [1, 1, 1]) ? '#000000' : '#ffffff'
}

export function needsOutline(fill: string, palette: SharePalette): boolean {
  return contrast(rgb(fill), rgb(palette.background)) < MIN_FILL_CONTRAST
}

export function layoutCard(summary: ShareSummary, options: { format: ShareFormat; copy: CardCopy; palette: SharePalette }, measure: Measure): CardLayout {
  const { format, copy, palette } = options
  const frame = CARD_FORMATS[format]
  const story = format === 'story'
  const width = frame.width - 2 * MARGIN
  const groups = shareGroups(summary)
  const names = showsNames(summary)

  function text(role: TextRole, value: string, x: number, baseline: number, font: FontSpec, color: string, maxWidth: number, align: 'left' | 'right' | 'center' = 'left'): TextOp {
    const advance = measure(value, font)
    const left = align === 'left' ? x : align === 'right' ? x - advance : x - advance / 2
    return {
      kind: 'text', role, text: value, font, color, direction: directionOf(value), baseline, maxWidth,
      box: { x: left, y: baseline - ASCENT * font.size, width: advance, height: (ASCENT + DESCENT) * font.size },
    }
  }

  function groupLook(group: ShareGroup): { fill?: string; outline?: { color: string; width: number }; glyph: string; glyphColor: string } {
    if (isOthers(group)) return { outline: { color: palette.category.gray, width: OUTLINE_WIDTH }, glyph: OTHERS_GLYPH, glyphColor: palette.label2 }
    const fill = colorValue(group.color, palette)
    return {
      fill,
      outline: needsOutline(fill, palette) ? { color: palette.label2, width: OUTLINE_WIDTH } : undefined,
      glyph: group.glyph,
      glyphColor: glyphColorOn(fill),
    }
  }

  const ops: DrawOp[] = [{ kind: 'background', color: palette.background }]

  // Header: the brand and "My typical week" on one line, at the top safe line.
  const headerBaseline = frame.safeTop + 14
  const brand = fitLine(summary.brandName, { weight: 700, size: 17, min: 14, maxWidth: width * 0.6 }, measure)
  const brandOp = text('brand', brand.text, MARGIN, headerBaseline, { weight: 700, size: brand.size }, palette.label, width * 0.6)
  ops.push(brandOp)
  const labelRoom = width - brandOp.box.width - 12
  const label = fitLine(copy.label, { weight: 400, size: 15, min: 12, maxWidth: labelRoom }, measure)
  ops.push(text('label', label.text, MARGIN + width, headerBaseline, { weight: 400, size: label.size }, palette.label2, labelRoom, 'right'))
  const headerBottom = headerBaseline + DESCENT * 17

  // Footer: at the bottom safe line.
  const footerBaseline = frame.height - frame.safeBottom
  const footer = fitLine(copy.footer, { weight: 600, size: 13, min: 11, maxWidth: width }, measure)
  const footerOp = text('footer', footer.text, MARGIN, footerBaseline, { weight: 600, size: footer.size }, palette.tintLabel, width)
  const footerTop = footerOp.box.y

  // Content, laid out from y = 0 and moved into place below.
  const content: DrawOp[] = []
  let y = 0
  const headline = story
    ? fitBlock(copy.headline, { weight: 700, size: 30, min: 17, maxLines: 2, maxWidth: width }, measure)
    : fitBlock(copy.headline, { weight: 700, size: 22, min: 17, maxLines: 1, maxWidth: width }, measure)
  for (const line of headline.lines) {
    const baseline = y + ASCENT * headline.size
    content.push(text('headline', line, MARGIN, baseline, { weight: 700, size: headline.size }, palette.label, width))
    y += headline.size * LINE_PITCH
  }
  y += story ? 14 : 8

  // The mosaic: 168 cells, each group's first cell carrying its glyph.
  const columns = frame.columns
  const rows = Math.ceil(168 / columns)
  const cell = (width - CELL_GAP * (columns - 1)) / columns
  const cells = cellsFor(groups)
  const seen = new Set<number>()
  cells.forEach((owner, index) => {
    const x = MARGIN + (index % columns) * (cell + CELL_GAP)
    const top = y + Math.floor(index / columns) * (cell + CELL_GAP)
    const base = { kind: 'rect' as const, role: 'cell' as const, group: owner, x, y: top, width: cell, height: cell, radius: cell * CELL_RADIUS }
    if (owner === FREE_CELL) {
      content.push({ ...base, fill: palette.free, outline: { color: palette.freeEdge, width: FREE_EDGE_WIDTH } })
      return
    }
    const look = groupLook(groups[owner]!)
    content.push({ ...base, fill: look.fill, outline: look.outline })
    if (seen.has(owner)) return
    seen.add(owner)
    const size = Math.round(cell * 0.62 * 10) / 10
    content.push(text('glyph', look.glyph, x + cell / 2, top + cell / 2 + (ASCENT - DESCENT) * size / 2, { weight: 600, size }, look.glyphColor, cell, 'center'))
  })
  y += rows * cell + (rows - 1) * CELL_GAP + 8

  // Caption: what one cell means, or that the cells are proportional because routines overlap. Every word is kept.
  const caption = fitBlock(copy.caption, { weight: 400, size: 11, min: 11, maxLines: 99, maxWidth: width }, measure)
  for (const line of caption.lines) {
    content.push(text('caption', line, MARGIN, y + ASCENT * 11, { weight: 400, size: 11 }, palette.label2, width))
    y += 11 * LINE_PITCH
  }
  y += story ? 14 : 8

  // Legend: two columns; swatch with the glyph, name, hours on the right, routine titles under the name when shown.
  const columnGap = 16
  const columnWidth = (width - columnGap) / 2
  const rowHeight = names ? 40 : 26
  const swatch = 14
  groups.forEach((group, index) => {
    const x = MARGIN + (index % 2) * (columnWidth + columnGap)
    const top = y + Math.floor(index / 2) * rowHeight
    const look = groupLook(group)
    content.push({ kind: 'rect', role: 'swatch', group: index, x, y: top + 3, width: swatch, height: swatch, radius: 3.5, fill: look.fill, outline: look.outline })
    content.push(text('glyph', look.glyph, x + swatch / 2, top + 3 + swatch / 2 + (ASCENT - DESCENT) * 9 / 2, { weight: 600, size: 9 }, look.glyphColor, swatch, 'center'))
    const hours = text('legend-hours', copy.hours(group.plannedMinutes), x + columnWidth, top + 15, { weight: 400, size: 15 }, palette.label2, columnWidth / 2, 'right')
    if (hours.box.width > columnWidth / 2) {
      const fitted = fitLine(hours.text, { weight: 400, size: 15, min: 11, maxWidth: columnWidth / 2 }, measure)
      content.push(text('legend-hours', fitted.text, x + columnWidth, top + 15, { weight: 400, size: fitted.size }, palette.label2, columnWidth / 2, 'right'))
    } else content.push(hours)
    const hoursWidth = Math.min(hours.box.width, columnWidth / 2)
    const nameRoom = columnWidth - swatch - 8 - hoursWidth - 6
    const name = fitLine(isOthers(group) ? copy.others(group.count) : group.name, { weight: 600, size: 15, min: 12, maxWidth: nameRoom }, measure)
    content.push(text('legend-name', name.text, x + swatch + 8, top + 15, { weight: 600, size: name.size }, palette.label, nameRoom))
    if (!isOthers(group) && group.routines?.length) {
      const routineRoom = columnWidth - swatch - 8
      const routines = fitLine(group.routines.join(' · '), { weight: 400, size: 12, min: 11, maxWidth: routineRoom }, measure)
      content.push(text('legend-routines', routines.text, x + swatch + 8, top + 31, { weight: 400, size: routines.size }, palette.label2, routineRoom))
    }
  })
  const legendRows = Math.ceil(groups.length / 2)
  y += legendRows > 0 ? (legendRows - 1) * rowHeight + (names ? 31 + DESCENT * 12 : 15 + DESCENT * 15) : 0

  // Story: the content block centred between the header and the footer. Square: top-aligned under the header.
  const regionTop = headerBottom + (story ? 16 : 10)
  const regionBottom = footerTop - (story ? 16 : 8)
  const offset = story ? regionTop + Math.max(0, (regionBottom - regionTop - y) / 2) : regionTop
  for (const op of content) ops.push(shift(op, offset))
  ops.push(footerOp)
  return { format, width: frame.width, height: frame.height, ops, contentBottom: offset + y, footerTop }
}

function shift(op: DrawOp, dy: number): DrawOp {
  if (op.kind === 'rect') return { ...op, y: op.y + dy }
  if (op.kind === 'text') return { ...op, baseline: op.baseline + dy, box: { ...op.box, y: op.box.y + dy } }
  return op
}
