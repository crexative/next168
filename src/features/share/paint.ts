import { LOCKUP_SYMBOL_TRANSFORM, LOCKUP_VIEW_BOX, LOCKUP_WORDMARK_TRANSFORM, SYMBOL_STROKE_WIDTH, SYMBOL_TICK, SYMBOL_W, WORDMARK_PATH } from '@/ui/brandMark'
import type { FontSpec, Measure } from './fitText'
import { CARD_FORMATS, CARD_SCALE, layoutCard, type CardCopy, type CardLayout, type ShareFormat } from './layout'
import { CARD_FONT, type SharePalette } from './palette'
import type { ShareSummary } from './shareSummary'

// The only Canvas code of the share card: it executes the layout's draw operations, nothing more.

export type CardContext = Pick<CanvasRenderingContext2D,
  'fillStyle' | 'strokeStyle' | 'lineWidth' | 'lineCap' | 'lineJoin' | 'font' | 'textAlign' | 'textBaseline' | 'direction'
  | 'fillRect' | 'beginPath' | 'roundRect' | 'fill' | 'stroke' | 'fillText' | 'measureText' | 'save' | 'restore' | 'translate' | 'scale'>

// Path2D from SVG path data; injected so tests can paint without a browser canvas.
export type MakePath = (data: string) => Path2D
const browserPath: MakePath = (data) => new Path2D(data)

// "translate(x y) scale(s)" or "translate(x y)" from brandMark.ts.
function applyTransform(context: CardContext, transform: string): void {
  const translate = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(transform)
  const scale = /scale\(([-\d.]+)\)/.exec(transform)
  if (translate) context.translate(Number(translate[1]), Number(translate[2]))
  if (scale) context.scale(Number(scale[1]), Number(scale[1]))
}

// The lockup drawn from the brand's own paths (src/ui/brandMark.ts), never a copy of the SVG.
function paintLockup(context: CardContext, op: Extract<CardLayout['ops'][number], { kind: 'lockup' }>, scale: number, makePath: MakePath): void {
  const [minX, minY, , boxHeight] = LOCKUP_VIEW_BOX.split(' ').map(Number) as [number, number, number, number]
  const unit = (op.height / boxHeight) * scale
  context.save()
  context.translate(op.x * scale, op.y * scale)
  context.scale(unit, unit)
  context.translate(-minX, -minY)
  context.save()
  applyTransform(context, LOCKUP_SYMBOL_TRANSFORM)
  context.lineWidth = SYMBOL_STROKE_WIDTH
  context.lineCap = 'round'
  context.lineJoin = 'round'
  context.strokeStyle = op.mark
  context.stroke(makePath(SYMBOL_W))
  context.strokeStyle = op.accent
  context.stroke(makePath(SYMBOL_TICK))
  context.restore()
  applyTransform(context, LOCKUP_WORDMARK_TRANSFORM)
  context.fillStyle = op.word
  context.fill(makePath(WORDMARK_PATH))
  context.restore()
}

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

export function paint(context: CardContext, card: CardLayout, scale: number = CARD_SCALE, makePath: MakePath = browserPath): void {
  context.textBaseline = 'alphabetic'
  for (const op of card.ops) {
    if (op.kind === 'lockup') {
      paintLockup(context, op, scale, makePath)
    } else if (op.kind === 'background') {
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
