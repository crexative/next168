import type { FontSpec, Measure } from './fitText'
import { CARD_FORMATS, CARD_SCALE, layoutCard, type CardCopy, type CardLayout, type ShareFormat } from './layout'
import { CARD_FONT, type SharePalette } from './palette'
import type { ShareSummary } from './shareSummary'

// The only Canvas code of the share card: it executes the layout's draw operations, nothing more.

export type CardContext = Pick<CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'font' | 'textAlign' | 'textBaseline' | 'direction'
  | 'fillRect' | 'beginPath' | 'roundRect' | 'fill' | 'stroke' | 'fillText' | 'measureText'>

function fontString(font: FontSpec, scale: number): string {
  return `${font.weight} ${font.size * scale}px ${CARD_FONT}`
}

// Advance widths in points, from the same context and font the painter draws with.
export function canvasMeasure(context: CardContext, scale: number = CARD_SCALE): Measure {
  return (text, font) => {
    context.font = fontString(font, scale)
    return context.measureText(text).width / scale
  }
}

export function paint(context: CardContext, card: CardLayout, scale: number = CARD_SCALE): void {
  context.textBaseline = 'alphabetic'
  for (const op of card.ops) {
    if (op.kind === 'background') {
      context.fillStyle = op.color
      context.fillRect(0, 0, card.width * scale, card.height * scale)
    } else if (op.kind === 'rect') {
      // An outline is drawn inside the shape, so neighbouring cells keep their gap.
      context.beginPath()
      context.roundRect(op.x * scale, op.y * scale, op.width * scale, op.height * scale, op.radius * scale)
      if (op.fill) {
        context.fillStyle = op.fill
        context.fill()
      }
      if (op.outline) {
        const inset = op.outline.width / 2
        context.beginPath()
        context.roundRect((op.x + inset) * scale, (op.y + inset) * scale, (op.width - 2 * inset) * scale, (op.height - 2 * inset) * scale, Math.max(0, op.radius - inset) * scale)
        context.strokeStyle = op.outline.color
        context.lineWidth = op.outline.width * scale
        context.stroke()
      }
    } else {
      context.font = fontString(op.font, scale)
      context.fillStyle = op.color
      // Right-to-left text keeps its own base direction inside the same box.
      context.direction = op.direction
      context.textAlign = op.direction === 'rtl' ? 'right' : 'left'
      const x = op.direction === 'rtl' ? op.box.x + op.box.width : op.box.x
      context.fillText(op.text, x * scale, op.baseline * scale)
    }
  }
  context.direction = 'ltr'
  context.textAlign = 'left'
}

// A canvas at 3x with the card laid out and painted (fonts measured by the same context that draws them).
export function renderCardCanvas(summary: ShareSummary, options: { format: ShareFormat; copy: CardCopy; palette: SharePalette }, ownerDocument: Document = document): HTMLCanvasElement {
  const frame = CARD_FORMATS[options.format]
  const canvas = ownerDocument.createElement('canvas')
  canvas.width = frame.width * CARD_SCALE
  canvas.height = frame.height * CARD_SCALE
  const context = canvas.getContext('2d')
  if (!context) throw new Error('share.noCanvas')
  paint(context, layoutCard(summary, options, canvasMeasure(context)))
  return canvas
}

export function encodePng(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'))
}
