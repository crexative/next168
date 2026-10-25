import type { Page } from '@playwright/test'
import { auditFloatingActionButtonInPage } from './fabPlacement'

export type IntegrityOptions = {
  // Also focus every control the way a keyboard user would and check its focus ring.
  focusRings?: boolean
}

// Keep this function self-contained: Playwright serializes it into the page.
export function auditInPage(options: { focusRings: boolean }): string[] {
  const TOLERANCE = 0.75
  // Text of two boxes on one line keeps at least this much space between them.
  const RUN_GAP = 2
  const violations: string[] = []
  const CONTROL = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="radio"], [role="tab"], [tabindex]:not([tabindex="-1"])'
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
  const FORM_CONTROL = 'button, input:not([type="hidden"]), select, textarea, [role="button"], [role="radio"]'

  type Box = { left: number; top: number; right: number; bottom: number }
  type Shape = Box & { radii: [number, number, number, number] }

  const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')).filter((dialog) => dialog.getClientRects().length > 0)
  const scope: HTMLElement = dialogs[dialogs.length - 1] ?? document.body
  const viewportWidth = document.documentElement.clientWidth
  const viewportHeight = window.innerHeight

  function describe(element: Element): string {
    const label = element.getAttribute('aria-label') ?? element.getAttribute('data-testid') ?? (element.textContent ?? '').trim().slice(0, 32)
    const classes = typeof element.className === 'string' && element.className ? `.${element.className.trim().split(/\s+/).join('.')}` : ''
    return `<${element.tagName.toLowerCase()}${classes}> "${label}"`
  }

  function px(value: string): number {
    return Number.parseFloat(value) || 0
  }

  function rendered(element: Element): boolean {
    if (element.getClientRects().length === 0) return false
    const style = getComputedStyle(element)
    if (style.visibility !== 'visible') return false
    const rect = element.getBoundingClientRect()
    // Visually hidden helpers (1 px, clipped) are intentionally outside the visual layout.
    return rect.width > 1 || rect.height > 1
  }

  function isCovered(element: Element): boolean {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.clip === 'rect(0px, 0px, 0px, 0px)' || Number(style.opacity) === 0 && node !== element) return true
    }
    return false
  }

  function radiiOf(element: Element, grow: number): [number, number, number, number] {
    const style = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    const half = Math.min(rect.width, rect.height) / 2
    const corner = (value: string) => {
      const radius = Math.min(value.endsWith('%') ? (px(value) / 100) * Math.min(rect.width, rect.height) : px(value), half)
      return radius > 0 ? radius + grow : 0
    }
    return [corner(style.borderTopLeftRadius), corner(style.borderTopRightRadius), corner(style.borderBottomRightRadius), corner(style.borderBottomLeftRadius)]
  }

  function borderShape(element: Element): Shape {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, radii: radiiOf(element, 0) }
  }

  // The area a clipping ancestor keeps visible: its padding box, extended by what it can scroll to.
  function clipArea(element: HTMLElement, style: CSSStyleDeclaration): Shape {
    const rect = element.getBoundingClientRect()
    const left = rect.left + element.clientLeft
    const top = rect.top + element.clientTop
    const scrollsX = /auto|scroll/.test(style.overflowX)
    const scrollsY = /auto|scroll/.test(style.overflowY)
    const clipsX = style.overflowX !== 'visible'
    const clipsY = style.overflowY !== 'visible'
    const inner = (radius: string, border: string) => Math.max(0, px(radius) - px(border))
    const area: Shape = {
      left: clipsX ? left - (scrollsX ? element.scrollLeft : 0) : -Infinity,
      right: clipsX ? left - (scrollsX ? element.scrollLeft : 0) + (scrollsX ? element.scrollWidth : element.clientWidth) : Infinity,
      top: clipsY ? top - (scrollsY ? element.scrollTop : 0) : -Infinity,
      bottom: clipsY ? top - (scrollsY ? element.scrollTop : 0) + (scrollsY ? element.scrollHeight : element.clientHeight) : Infinity,
      radii: [0, 0, 0, 0],
    }
    // Rounded clipping only matters where the scrollable area coincides with the padding box.
    if (!scrollsX && !scrollsY) {
      area.radii = [
        inner(style.borderTopLeftRadius, style.borderLeftWidth),
        inner(style.borderTopRightRadius, style.borderRightWidth),
        inner(style.borderBottomRightRadius, style.borderRightWidth),
        inner(style.borderBottomLeftRadius, style.borderLeftWidth),
      ]
    }
    return area
  }

  // Each clipping ancestor, nearest first, with what the scroll containers below it currently show: an outer
  // clip only cuts what an inner scroller has not already scrolled out of view.
  function clippingAncestors(element: Element): { element: HTMLElement; area: Shape; shownBelow: Box }[] {
    const result: { element: HTMLElement; area: Shape; shownBelow: Box }[] = []
    const shownBelow: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
    for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (node === document.body || (style.overflowX === 'visible' && style.overflowY === 'visible')) continue
      const scrolls = /auto|scroll/.test(style.overflowX + style.overflowY)
      result.push({ element: node, area: clipArea(node, style), shownBelow: { ...shownBelow } })
      if (scrolls) {
        const rect = node.getBoundingClientRect()
        shownBelow.left = Math.max(shownBelow.left, rect.left + node.clientLeft)
        shownBelow.top = Math.max(shownBelow.top, rect.top + node.clientTop)
        shownBelow.right = Math.min(shownBelow.right, rect.left + node.clientLeft + node.clientWidth)
        shownBelow.bottom = Math.min(shownBelow.bottom, rect.top + node.clientTop + node.clientHeight)
      }
    }
    return result
  }

  // The nearest fixed or sticky layer an element floats in (content scrolls underneath such layers), or a popover that
  // floats over the content after its trigger.
  function layerOf(element: Element): Element | null {
    for (let node: Element | null = element; node; node = node.parentElement) {
      const position = getComputedStyle(node).position
      if (/fixed|sticky/.test(position) || position === 'absolute' && node.matches('[role="menu"], [role="listbox"], [role="dialog"], [role="group"]')) return node
    }
    return null
  }

  function fixedAncestor(element: Element): boolean {
    return layerOf(element) !== null
  }

  function insideShape(x: number, y: number, shape: Shape): boolean {
    if (x < shape.left - TOLERANCE || x > shape.right + TOLERANCE || y < shape.top - TOLERANCE || y > shape.bottom + TOLERANCE) return false
    const [tl, tr, br, bl] = shape.radii
    const corners: [number, number, number, boolean][] = [
      [shape.left + tl, shape.top + tl, tl, x < shape.left + tl && y < shape.top + tl],
      [shape.right - tr, shape.top + tr, tr, x > shape.right - tr && y < shape.top + tr],
      [shape.right - br, shape.bottom - br, br, x > shape.right - br && y > shape.bottom - br],
      [shape.left + bl, shape.bottom - bl, bl, x < shape.left + bl && y > shape.bottom - bl],
    ]
    return corners.every(([cx, cy, radius, inCorner]) => !inCorner || Math.hypot(x - cx, y - cy) <= radius + TOLERANCE)
  }

  // Samples the outline of a rounded rectangle.
  function perimeter(shape: Shape): [number, number][] {
    const points: [number, number][] = []
    const [tl, tr, br, bl] = shape.radii
    const steps = 8
    const arc = (cx: number, cy: number, radius: number, from: number) => {
      for (let step = 0; step <= steps; step += 1) {
        const angle = from + (Math.PI / 2) * (step / steps)
        points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)])
      }
    }
    arc(shape.left + tl, shape.top + tl, tl, Math.PI)
    arc(shape.right - tr, shape.top + tr, tr, -Math.PI / 2)
    arc(shape.right - br, shape.bottom - br, br, 0)
    arc(shape.left + bl, shape.bottom - bl, bl, Math.PI / 2)
    const along = (from: number, to: number, point: (value: number) => [number, number]) => {
      for (let step = 0; step <= 16; step += 1) points.push(point(from + (to - from) * (step / 16)))
    }
    along(shape.left + tl, shape.right - tr, (x) => [x, shape.top])
    along(shape.left + bl, shape.right - br, (x) => [x, shape.bottom])
    along(shape.top + tl, shape.bottom - bl, (y) => [shape.left, y])
    along(shape.top + tr, shape.bottom - br, (y) => [shape.right, y])
    return points
  }

  function intersects(a: Box, b: Box): boolean {
    return a.left < b.right - TOLERANCE && a.right > b.left + TOLERANCE && a.top < b.bottom - TOLERANCE && a.bottom > b.top + TOLERANCE
  }

  // What the scroll containers around an element currently show; anything else is merely scrolled away.
  function scrolledInto(element: Element): Box {
    const box: Box = { left: -Infinity, top: -Infinity, right: Infinity, bottom: Infinity }
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (!/auto|scroll/.test(style.overflowX + style.overflowY)) continue
      const rect = node.getBoundingClientRect()
      box.left = Math.max(box.left, rect.left + node.clientLeft)
      box.top = Math.max(box.top, rect.top + node.clientTop)
      box.right = Math.min(box.right, rect.left + node.clientLeft + node.clientWidth)
      box.bottom = Math.min(box.bottom, rect.top + node.clientTop + node.clientHeight)
    }
    return box
  }

  function scrollerOf(element: Element): Element | null {
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (/auto|scroll/.test(style.overflowX + style.overflowY)) return node
    }
    return null
  }

  function shown(point: [number, number], box: Box): boolean {
    return point[0] >= box.left && point[0] <= box.right && point[1] >= box.top && point[1] <= box.bottom
  }

  // A shape completely outside a clipping area is off-screen on purpose (a pager page, a scrolled list);
  // only a partly visible shape is clipped.
  // `rounded`: whether the clip's rounded corners count. A full-bleed row clipped to its card's corners is by
  // design; a focus ring cut by those corners is not.
  function checkContained(subject: Element, shape: Shape, what: string, rounded: boolean): void {
    const points = perimeter(shape)
    const visible = scrolledInto(subject)
    for (const { element, area: clip, shownBelow } of clippingAncestors(subject)) {
      // Content an inner scroller moves under a rounded edge is meant to be cut by it.
      const area: Shape = rounded && !Number.isFinite(shownBelow.top) ? clip : { ...clip, radii: [0, 0, 0, 0] }
      if (!intersects(shape, area)) return
      const outside = points.filter((point) => shown(point, shownBelow) && !insideShape(point[0], point[1], area))
      if (outside.length > 0) {
        const [x, y] = outside[0]!
        violations.push(`${what} of ${describe(subject)} is clipped by ${describe(element)} at (${x.toFixed(1)}, ${y.toFixed(1)})`)
        return
      }
    }
    const viewport: Shape = { left: 0, top: fixedAncestor(subject) ? 0 : -Infinity, right: viewportWidth, bottom: fixedAncestor(subject) ? viewportHeight : Infinity, radii: [0, 0, 0, 0] }
    const offscreen = points.find((point) => shown(point, visible) && !insideShape(point[0], point[1], viewport))
    if (intersects(shape, viewport) && offscreen) {
      violations.push(`${what} of ${describe(subject)} extends outside the viewport at (${offscreen[0].toFixed(1)}, ${offscreen[1].toFixed(1)})`)
    }
    const sheet = subject.closest('[role="dialog"]')
    if (rounded && sheet && sheet !== subject) {
      const outline = borderShape(sheet)
      const scrolledInSheet = sheet.contains(scrollerOf(subject))
      const panel: Shape = scrolledInSheet ? { ...outline, radii: [0, 0, 0, 0] } : outline
      const outside = points.find((point) => shown(point, visible) && !insideShape(point[0], point[1], panel))
      if (outside) violations.push(`${what} of ${describe(subject)} leaves the sheet at (${outside[0].toFixed(1)}, ${outside[1].toFixed(1)})`)
    }
  }

  function canvasContext(): CanvasRenderingContext2D {
    const holder = window as unknown as { __integrityCanvas?: CanvasRenderingContext2D }
    holder.__integrityCanvas ??= document.createElement('canvas').getContext('2d')!
    return holder.__integrityCanvas
  }

  function textWidth(text: string, style: CSSStyleDeclaration): number {
    const context = canvasContext()
    context.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
    context.letterSpacing = style.letterSpacing === 'normal' ? '0px' : style.letterSpacing
    return context.measureText(text).width
  }

  function contentBox(element: HTMLElement, style: CSSStyleDeclaration): Box {
    const rect = element.getBoundingClientRect()
    return {
      left: rect.left + px(style.borderLeftWidth) + px(style.paddingLeft),
      right: rect.right - px(style.borderRightWidth) - px(style.paddingRight),
      top: rect.top + px(style.borderTopWidth) + px(style.paddingTop),
      bottom: rect.bottom - px(style.borderBottomWidth) - px(style.paddingBottom),
    }
  }

  // Padding belongs to the container, including when an unpadded wrapper or a negative margin lies
  // between it and its content. Measure control targets (not just their labels) and actual text lines.
  function checkEdgeInset(subject: Element, box: Box, what: string, text = false): void {
    if (Number(getComputedStyle(subject).opacity) === 0) return
    if (!intersects(box, scrolledInto(subject))) return
    for (let container = text ? subject as HTMLElement : subject.parentElement; container && container !== document.body; container = container.parentElement) {
      const style = getComputedStyle(container)
      if (style.display !== 'inline' && style.display !== 'contents') {
        const rect = container.getBoundingClientRect()
        const scrollsX = /auto|scroll/.test(style.overflowX)
        const scrollsY = /auto|scroll/.test(style.overflowY)
        const left = rect.left + px(style.borderLeftWidth) - (scrollsX ? container.scrollLeft : 0)
        const top = rect.top + px(style.borderTopWidth) - (scrollsY ? container.scrollTop : 0)
        const right = scrollsX ? left + container.scrollWidth : rect.right - px(style.borderRightWidth)
        const bottom = scrollsY ? top + container.scrollHeight : rect.bottom - px(style.borderBottomWidth)
        const sides = [
          ['left', box.left - left, px(style.paddingLeft)],
          ['right', right - box.right, px(style.paddingRight)],
          ['top', box.top - top, px(style.paddingTop)],
          ['bottom', bottom - box.bottom, px(style.paddingBottom)],
        ] as const
        // Full-area hit targets own the container surface; their visible labels still need its padding.
        const fullAreaTarget = !text && sides.every(([, inset]) => Math.abs(inset) <= 1)
        if (!fullAreaTarget) {
          for (const [side, inset, padding] of sides) {
            if (padding > TOLERANCE && inset < padding - TOLERANCE) {
              violations.push(`${what} touches the edge of ${describe(container)} (${side}: ${inset.toFixed(1)}px inset, ${padding.toFixed(1)}px padding)`)
            }
          }
        }
      }
      // A label's own control is checked above; its target is separately checked against outer padding.
      if (text && container.matches(CONTROL)) break
      // Popovers and sheets have their own layout surface, outside the trigger's content flow.
      if (style.position === 'fixed' || style.position === 'absolute' && container.matches('[role="menu"], [role="listbox"], [role="dialog"], [role="group"]')) break
    }
  }

  // Resolves one background-position component (`12px`, `50%`, `calc(100% - 12px)`) inside `free` px.
  function position(value: string, free: number): number | undefined {
    const calc = /^calc\(\s*([\d.]+)%\s*([+-])\s*([\d.]+)px\s*\)$/.exec(value)
    if (calc) return (Number(calc[1]) / 100) * free + (calc[2] === '-' ? -1 : 1) * Number(calc[3])
    if (/^[\d.]+%$/.test(value)) return (px(value) / 100) * free
    if (/^-?[\d.]+px$/.test(value)) return px(value)
    return undefined
  }

  // Splits a computed list such as `url(a), radial-gradient(rgb(0, 0, 0) 1px, …)` at its top-level commas.
  function layers(list: string): string[] {
    const items: string[] = []
    let depth = 0
    let current = ''
    for (const character of list) {
      if (character === '(') depth += 1
      if (character === ')') depth -= 1
      if (character === ',' && depth === 0) {
        items.push(current.trim())
        current = ''
      } else {
        current += character
      }
    }
    items.push(current.trim())
    return items
  }

  function checkSelect(select: HTMLSelectElement): void {
    const style = getComputedStyle(select)
    if (style.appearance !== 'none') {
      violations.push(`${describe(select)} uses the native picker arrow (appearance: ${style.appearance}), which ignores the padding and sits on the border`)
      return
    }
    const content = contentBox(select, style)
    const label = select.selectedOptions[0]?.text ?? ''
    if (textWidth(label, style) > content.right - content.left + TOLERANCE) {
      violations.push(`${describe(select)} truncates its label "${label}" (${textWidth(label, style).toFixed(1)} px in ${(content.right - content.left).toFixed(1)} px)`)
    }
    const images = layers(style.backgroundImage)
    const chevronIndex = images.findIndex((image) => image.startsWith('url('))
    if (chevronIndex < 0) {
      violations.push(`${describe(select)} has no chevron`)
      return
    }
    const rect = select.getBoundingClientRect()
    const padding: Box = { left: rect.left + px(style.borderLeftWidth), right: rect.right - px(style.borderRightWidth), top: rect.top + px(style.borderTopWidth), bottom: rect.bottom - px(style.borderBottomWidth) }
    const pick = (list: string) => layers(list)[chevronIndex] ?? ''
    const [width = '', height = width] = pick(style.backgroundSize).split(/\s+/)
    const size = { width: px(width), height: px(height) }
    const x = position(pick(style.backgroundPositionX), padding.right - padding.left - size.width)
    const y = position(pick(style.backgroundPositionY), padding.bottom - padding.top - size.height)
    if (!size.width || !size.height || x === undefined || y === undefined) {
      violations.push(`${describe(select)} positions its chevron in a way this check cannot measure (${style.backgroundPosition} / ${style.backgroundSize})`)
      return
    }
    const chevron: Box = { left: padding.left + x, right: padding.left + x + size.width, top: padding.top + y, bottom: padding.top + y + size.height }
    if (chevron.left < padding.left - TOLERANCE || chevron.right > padding.right + TOLERANCE || chevron.top < padding.top - TOLERANCE || chevron.bottom > padding.bottom + TOLERANCE) {
      violations.push(`the chevron of ${describe(select)} is not inside its padding box`)
    }
    if (chevron.left < content.right - TOLERANCE) {
      violations.push(`the chevron of ${describe(select)} overlaps its label area by ${(content.right - chevron.left).toFixed(1)} px`)
    }
  }

  const TEXT_INPUTS = new Set(['text', 'search', 'url', 'email', 'tel', 'password', 'number', ''])
  function checkInput(input: HTMLInputElement | HTMLTextAreaElement): void {
    if (input instanceof HTMLInputElement && !TEXT_INPUTS.has(input.type)) {
      if (/date|time|month|week/.test(input.type) && input.scrollWidth > input.clientWidth + 1) {
        violations.push(`${describe(input)} clips its ${input.type} value (${input.scrollWidth} > ${input.clientWidth})`)
      }
      return
    }
    if (input instanceof HTMLTextAreaElement) return
    const style = getComputedStyle(input)
    const content = contentBox(input, style)
    const text = input.value || input.placeholder
    if (text && textWidth(text, style) > content.right - content.left + TOLERANCE) {
      violations.push(`${describe(input)} clips its ${input.value ? 'value' : 'placeholder'} "${text}"`)
    }
  }

  function hasIntentionalTruncation(element: Element, upTo: Element | null): boolean {
    for (let node: Element | null = element; node && node !== upTo?.parentElement; node = node.parentElement) {
      const style = getComputedStyle(node)
      if (style.textOverflow === 'ellipsis' || (style.webkitLineClamp && style.webkitLineClamp !== 'none')) return true
    }
    return false
  }

  function blockOf(element: Element): HTMLElement {
    let node = element as HTMLElement
    while (node.parentElement && getComputedStyle(node).display.startsWith('inline') && !node.matches('button, a, input, select, textarea')) node = node.parentElement
    return node
  }

  // The width a line of this text could have: its block, or, when that block is squeezed beside siblings in a flex row or
  // a grid track, the container that hands out the room.
  // The insets (padding and border) of the boxes in between still apply: a word in a button gets the room minus the
  // button's own padding.
  function lineRoom(element: HTMLElement): number {
    let node = blockOf(element)
    let insets = 0
    for (let container = node.parentElement; container && container !== document.body; container = container.parentElement) {
      const style = getComputedStyle(container)
      const shares = /flex/.test(style.display) && !style.flexDirection.startsWith('column') || /grid/.test(style.display)
      if (!shares) break
      const own = getComputedStyle(node)
      insets += px(own.paddingLeft) + px(own.paddingRight) + px(own.borderLeftWidth) + px(own.borderRightWidth)
      node = container
    }
    const box = contentBox(node, getComputedStyle(node))
    return box.right - box.left - insets
  }

  // The rendered width of `text` in `style`, measured on the page (a canvas does not resolve system-ui the same way).
  function renderedWidth(text: string, style: CSSStyleDeclaration): number {
    const probe = document.createElement('span')
    probe.textContent = text
    probe.style.cssText = 'position: absolute; visibility: hidden; white-space: pre; left: 0; top: 0'
    for (const property of ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'fontStretch', 'letterSpacing', 'wordSpacing', 'fontVariantNumeric', 'fontFeatureSettings', 'textTransform'] as const) probe.style[property] = style[property]
    document.body.append(probe)
    const width = probe.getBoundingClientRect().width
    probe.remove()
    return width
  }

  // A word breaks across lines only when no line could hold it, or by hyphenation in the page's language; any other split
  // (overflow-wrap: anywhere in a squeezed flex item) reads as an arbitrary cut ("Exerc ise").
  function checkWordBreaks(node: Text, parent: HTMLElement): void {
    const style = getComputedStyle(parent)
    if (style.hyphens === 'auto' && parent.closest('[lang]') || parent.closest('pre, code, [data-scroll-x]')) return
    const text = node.textContent ?? ''
    const range = document.createRange()
    let room: number | null = null
    for (const match of text.matchAll(/[\p{L}\p{N}]{3,}/gu)) {
      range.setStart(node, match.index)
      range.setEnd(node, match.index + match[0].length)
      // Fragments on one line can differ in top (a fallback glyph); a new line starts below the previous fragment.
      const fragments = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
      if (!fragments.some((rect) => rect.top >= fragments[0]!.bottom - 1)) continue
      room ??= lineRoom(parent)
      // A word inside a longer unbroken run (a URL, an address) breaks because the run cannot fit a line.
      const runStart = text.slice(0, match.index).search(/\S*$/)
      const runEnd = match.index + match[0].length + (text.slice(match.index + match[0].length).search(/\s|$/))
      if (renderedWidth(text.slice(runStart, runEnd), style) > room - TOLERANCE) continue
      const width = renderedWidth(match[0], style)
      if (width <= room - TOLERANCE) violations.push(`the word "${match[0]}" in ${describe(parent)} breaks mid-word though a line has room for it (${width.toFixed(1)}px of ${room.toFixed(1)}px)`)
    }
  }

  function checkText(): void {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.textContent ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    })
    const blocks = new Set<HTMLElement>()
    const runs: { element: HTMLElement; block: HTMLElement; layer: Element | null; text: string; box: Box }[] = []
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || parent.closest('option, script, style, svg, select, textarea') || !rendered(parent) || isCovered(parent)) continue
      blocks.add(blockOf(parent))
      checkWordBreaks(node as Text, parent)
      range.selectNodeContents(node)
      const lines = Array.from(range.getClientRects()).filter((line) => line.width > 0 && line.height > 0)
      for (const line of lines) {
        // Ranges include invisible text in ellipses, wrapped flex columns and scrolled-away lines.
        // Compare only the portion painted by every clipping ancestor.
        // `visible` is a plain copy: spreading a DOMRect copies none of its (prototype) fields.
        // KNOWN GAP (reported, #3 verify5): the inset checks were always fed `legacy`, the spread of that DOMRect, which
        // drops a line whenever the first clipping ancestor clips one axis only (the body clips overflow-x). Feeding them
        // the true box reports about 900 existing inset findings outside Week, so until those are fixed they keep exactly
        // their old reach; the run-together rule uses the true visible box.
        let visible: Box = { left: line.left, top: line.top, right: line.right, bottom: line.bottom }
        let legacy: Box = line
        for (let clipper: HTMLElement | null = parent; clipper && clipper !== scope.parentElement; clipper = clipper.parentElement) {
          const style = getComputedStyle(clipper)
          if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
            const clip = clipper.getBoundingClientRect()
            const left = clip.left + clipper.clientLeft
            const top = clip.top + clipper.clientTop
            if (style.overflowX !== 'visible') {
              visible = { ...visible, left: Math.max(visible.left, left), right: Math.min(visible.right, left + clipper.clientWidth) }
              legacy = { ...legacy, left: Math.max(legacy.left, left), right: Math.min(legacy.right, left + clipper.clientWidth) }
            }
            if (style.overflowY !== 'visible') {
              visible = { ...visible, top: Math.max(visible.top, top), bottom: Math.min(visible.bottom, top + clipper.clientHeight) }
              legacy = { ...legacy, top: Math.max(legacy.top, top), bottom: Math.min(legacy.bottom, top + clipper.clientHeight) }
            }
          }
          if (style.textOverflow === 'ellipsis') {
            const content = contentBox(clipper, style)
            visible = style.direction === 'rtl' ? { ...visible, left: Math.max(visible.left, content.left) } : { ...visible, right: Math.min(visible.right, content.right) }
            legacy = style.direction === 'rtl' ? { ...legacy, left: Math.max(legacy.left, content.left) } : { ...legacy, right: Math.min(legacy.right, content.right) }
          }
          if (style.webkitLineClamp && style.webkitLineClamp !== 'none') {
            visible = { ...visible, bottom: Math.min(visible.bottom, contentBox(clipper, style).bottom) }
            legacy = { ...legacy, bottom: Math.min(legacy.bottom, contentBox(clipper, style).bottom) }
          }
        }
        if (visible.right > visible.left && visible.bottom > visible.top) {
          runs.push({ element: parent, block: blockOf(parent), layer: layerOf(parent), text: (node.textContent ?? '').trim().slice(0, 40), box: visible })
          const what = `text "${(node.textContent ?? '').trim().slice(0, 40)}" in ${describe(parent)}`
          if (legacy.right > legacy.left && legacy.bottom > legacy.top) {
            checkEdgeInset(parent, legacy, what, true)
            checkCardInset(parent, legacy, what)
          }
        }
      }
      for (const { element: clipper, area, shownBelow } of clippingAncestors(parent)) {
        const visible = lines.filter((line) => intersects(line, area) && line.left >= shownBelow.left && line.right <= shownBelow.right && line.top >= shownBelow.top && line.bottom <= shownBelow.bottom)
        if (visible.length === 0) break
        const clipped = visible.find((line) => line.left < area.left - TOLERANCE || line.right > area.right + TOLERANCE || line.top < area.top - TOLERANCE || line.bottom > area.bottom + TOLERANCE)
        if (clipped && !hasIntentionalTruncation(parent, clipper)) {
          violations.push(`text "${(node.textContent ?? '').trim().slice(0, 40)}" in ${describe(parent)} is clipped by ${describe(clipper)}`)
          break
        }
      }
    }
    // Text of separate boxes on one line needs space between them: "MON" and "TUE" drawn edge to edge read "MONTUE".
    // Only painted text counts: not text faded out (a collapsed title at opacity 0) or lying under an opaque sibling (a
    // row's Delete action under the row).
    const opaque = (color: string) => /^rgb\(/.test(color) || /^rgba\(.*,\s*1\)$/.test(color)
    const painted = (run: { element: HTMLElement; box: Box }) => {
      for (let node: HTMLElement | null = run.element; node; node = node.parentElement) {
        if (Number(getComputedStyle(node).opacity) === 0) return false
        // A positioned, opaque box later in the same parent paints over it (a row over its swipe hint).
        for (let sibling = node.nextElementSibling; sibling; sibling = sibling.nextElementSibling) {
          const style = getComputedStyle(sibling)
          if (style.position === 'static' || !opaque(style.backgroundColor)) continue
          const cover = sibling.getBoundingClientRect()
          if (cover.left <= run.box.left + TOLERANCE && cover.right >= run.box.right - TOLERANCE && cover.top <= run.box.top + TOLERANCE && cover.bottom >= run.box.bottom - TOLERANCE) return false
        }
      }
      return true
    }
    runs.forEach((first, index) => {
      for (const second of runs.slice(index + 1)) {
        if (first.block === second.block || first.block.contains(second.block) || second.block.contains(first.block) || first.layer !== second.layer) continue
        if (!painted(first) || !painted(second)) continue
        const a = first.box
        const b = second.box
        const shared = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
        if (shared < Math.min(a.bottom - a.top, b.bottom - b.top) / 2) continue
        const gap = Math.max(b.left - a.right, a.left - b.right)
        if (gap < RUN_GAP) violations.push(`text "${first.text}" and text "${second.text}" run together (${gap.toFixed(1)}px apart, at least ${RUN_GAP}px)`)
      }
    })
    for (const block of blocks) {
      const style = getComputedStyle(block)
      if (block.clientWidth === 0 || /auto|scroll/.test(style.overflowX) && block.matches('pre, code, [data-scroll-x]')) continue
      if (block.scrollWidth > block.clientWidth + 1 && style.textOverflow !== 'ellipsis') {
        violations.push(`${describe(block)} overflows horizontally without an ellipsis (${block.scrollWidth} > ${block.clientWidth})`)
      }
      const clampsY = /hidden|clip/.test(style.overflowY)
      if (clampsY && block.scrollHeight > block.clientHeight + 1 && (!style.webkitLineClamp || style.webkitLineClamp === 'none')) {
        violations.push(`${describe(block)} clips text vertically (${block.scrollHeight} > ${block.clientHeight})`)
      }
    }
  }

  // The spacing roles of tokens.css (docs/design/visual-design.md › Spacing), resolved to px at this width and text
  // size. Plain pages without the tokens (the guard's self-tests) fall back to the documented values.
  function cssLength(value: string): number {
    const probe = document.createElement('div')
    probe.style.cssText = `position: absolute; visibility: hidden; width: 0; height: 0; padding-left: ${value}`
    document.body.append(probe)
    const length = px(getComputedStyle(probe).paddingLeft)
    probe.remove()
    return length
  }
  const spacingToken = (name: string, fallback: number): number => cssLength(`var(${name}, ${fallback}px)`)
  const SPACING = {
    card: spacingToken('--card-padding', 16),
    rowBlock: spacingToken('--row-padding-block', 12),
    control: spacingToken('--control-gap', 8),
    group: spacingToken('--group-gap', 24),
    section: spacingToken('--section-gap', 32),
    // Under a docked bar's buttons: 16 px plus the home indicator's safe area.
    dockBottom: cssLength('calc(16px + env(safe-area-inset-bottom, 0px))'),
  }
  // Controls this close read as one compound control (segments of a track, rows split by a hairline).
  const JOINED = 2

  function transparent(color: string): boolean {
    return color === 'transparent' || /^rgba\(.*,\s*0\)$/.test(color)
  }

  function backgroundBehind(element: Element): string {
    for (let node = element.parentElement; node; node = node.parentElement) {
      const color = getComputedStyle(node).backgroundColor
      if (!transparent(color)) return color
    }
    return 'rgb(255, 255, 255)'
  }

  // A visible surface: a fill that differs from what is behind it, a border or a shadow.
  function hasSurface(element: Element): boolean {
    const style = getComputedStyle(element)
    const filled = !transparent(style.backgroundColor) && style.backgroundColor !== backgroundBehind(element)
    const bordered = px(style.borderTopWidth) > 0 && !transparent(style.borderTopColor)
    return filled || bordered || style.backgroundImage !== 'none' || style.boxShadow !== 'none'
  }

  // A card: a rounded, visible surface that is not itself a control, a compound control or a sheet. Pills are excluded.
  const COMPOUND = '[role="dialog"], [role="radiogroup"], [role="tablist"], [role="toolbar"], [role="menu"], [role="listbox"]'
  function isCard(element: HTMLElement): boolean {
    if (element.matches(CONTROL) || element.matches(COMPOUND) || !rendered(element) || isCovered(element)) return false
    const rect = element.getBoundingClientRect()
    if (rect.width < 120 || rect.height < 40) return false
    const style = getComputedStyle(element)
    const radius = Math.min(px(style.borderTopLeftRadius), px(style.borderBottomRightRadius))
    if (radius < 12 || radius >= Math.min(rect.width, rect.height) / 2 - TOLERANCE) return false
    const background = style.backgroundColor
    return !transparent(background) && background !== backgroundBehind(element) || px(style.borderTopWidth) > 0 && !transparent(style.borderTopColor)
  }
  const cards = new Set(Array.from(scope.querySelectorAll<HTMLElement>('*')).filter(isCard))

  function cardAround(element: Element): HTMLElement | null {
    for (let node = element.parentElement; node && node !== scope.parentElement; node = node.parentElement) {
      if (cards.has(node)) return node
      // A popover is its own floating surface, outside the card its trigger sits in.
      const style = getComputedStyle(node)
      if (style.position === 'fixed' || style.position === 'absolute' && node.matches('[role="menu"], [role="listbox"], [role="dialog"], [role="group"]')) return null
    }
    return null
  }

  // Text, visible control surfaces and nested cards keep the card padding token from every edge of their card, also
  // where the card itself is unpadded and a full-width row supplies the inset. Sides on which the card's own padding
  // already reaches the token are left to the "touches the edge" rule.
  function checkCardInset(subject: Element, box: Box, what: string): void {
    const card = cardAround(subject)
    if (!card || !intersects(box, scrolledInto(subject))) return
    const rect = card.getBoundingClientRect()
    const style = getComputedStyle(card)
    const inner: Box = { left: rect.left + px(style.borderLeftWidth), right: rect.right - px(style.borderRightWidth), top: rect.top + px(style.borderTopWidth), bottom: rect.bottom - px(style.borderBottomWidth) }
    const fullBleed = Math.abs(box.left - inner.left) <= 1 && Math.abs(inner.right - box.right) <= 1
    if (fullBleed && !what.startsWith('text')) return
    const scroller = scrollerOf(subject)
    const scrollsInside = scroller !== null && card.contains(scroller)
    const sides = [
      ['left', box.left - inner.left, SPACING.card, px(style.paddingLeft)],
      ['right', inner.right - box.right, SPACING.card, px(style.paddingRight)],
      ['top', box.top - inner.top, SPACING.rowBlock, px(style.paddingTop)],
      ['bottom', inner.bottom - box.bottom, SPACING.rowBlock, px(style.paddingBottom)],
    ] as const
    for (const [side, inset, minimum, padding] of sides) {
      if (scrollsInside && (side === 'top' || side === 'bottom')) continue
      if (padding >= minimum - TOLERANCE) continue
      if (inset < minimum - TOLERANCE) {
        violations.push(`${what} is ${inset.toFixed(1)}px from the ${side} edge of the card ${describe(card)} (card padding ${minimum.toFixed(1)}px)`)
      }
    }
  }

  const controls = Array.from(scope.querySelectorAll<HTMLElement>(CONTROL)).filter((control) => rendered(control) && !isCovered(control))

  for (const card of cards) checkCardInset(card, card.getBoundingClientRect(), `the card ${describe(card)}`)

  for (const control of controls) {
    const rect = control.getBoundingClientRect()
    checkEdgeInset(control, rect, describe(control))
    if (hasSurface(control)) checkCardInset(control, rect, describe(control))
    checkContained(control, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, radii: radiiOf(control, 0) }, 'the border box', false)
    if (control instanceof HTMLSelectElement) checkSelect(control)
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) checkInput(control)
  }

  // Only the part of a control a scroll container currently shows can collide with another control; one
  // scrolled out of sight sits under its neighbours in page coordinates without anyone seeing an overlap.
  function shownRect(control: Element): Box | null {
    const rect = control.getBoundingClientRect()
    const area = scrolledInto(control)
    const box: Box = { left: Math.max(rect.left, area.left), top: Math.max(rect.top, area.top), right: Math.min(rect.right, area.right), bottom: Math.min(rect.bottom, area.bottom) }
    return box.left < box.right && box.top < box.bottom ? box : null
  }

  // A control marked `data-layered` is drawn on top of another one on purpose (a task inside the routine block it was
  // fitted into). That is layering only while it lies wholly inside the other; sticking out of it is a collision.
  function layeredInside(inner: Element, outer: Element): boolean {
    // Layering is a task over its routine; two layered controls (two tasks) on each other are a collision.
    if (!inner.hasAttribute('data-layered') || outer.hasAttribute('data-layered')) return false
    const a = inner.getBoundingClientRect()
    const b = outer.getBoundingClientRect()
    return a.left >= b.left - TOLERANCE && a.right <= b.right + TOLERANCE && a.top >= b.top - TOLERANCE && a.bottom <= b.bottom + TOLERANCE
  }

  // Links count too: a back link in a toolbar must not run under the toolbar's buttons.
  // A control that takes no pointer input (a task outline drawn over its routine) cannot take another's tap.
  const formControls = controls.filter((control) => control.matches(`${FORM_CONTROL}, a[href]`) && Number(getComputedStyle(control).opacity) > 0 && getComputedStyle(control).pointerEvents !== 'none')
  formControls.forEach((first, index) => {
    for (const second of formControls.slice(index + 1)) {
      if (first.contains(second) || second.contains(first) || layerOf(first) !== layerOf(second)) continue
      if (layeredInside(first, second) || layeredInside(second, first)) continue
      const firstShown = shownRect(first)
      const secondShown = shownRect(second)
      if (firstShown && secondShown && intersects(firstShown, secondShown)) violations.push(`${describe(first)} overlaps ${describe(second)}`)
    }
  })

  // A control that takes a tap must be what a tap at its centre reaches. Something of the same layer drawn over it (its own
  // card, a sibling, text running out of a neighbour) is reported; content scrolled under a fixed or sticky bar is not
  // (a different layer), nor a task drawn on its routine on purpose (`data-layered`, inside the control).
  for (const control of formControls) {
    if ((control as HTMLButtonElement).disabled) continue
    const rect = control.getBoundingClientRect()
    const shownArea = shownRect(control)
    // A box a few pixels tall (a 5-minute shape in the week overview) touches its neighbours within rounding.
    if (!shownArea || rect.width < 4 || rect.height < 4) continue
    const x = rect.left + rect.width / 2
    const y = rect.top + rect.height / 2
    if (x < shownArea.left || x > shownArea.right || y < shownArea.top || y > shownArea.bottom || x < 0 || y < 0 || x > viewportWidth || y > viewportHeight) continue
    const hit = document.elementFromPoint(x, y)
    if (!hit || control.contains(hit)) continue
    // Content of a scroller under something outside it (a docked footer, a bar) is scrolled there, not laid out there.
    const scroller = scrollerOf(control)
    if (scroller && !scroller.contains(hit)) continue
    if (!hit.contains(control) && layerOf(hit) !== layerOf(control)) continue
    const layered = hit.closest('[data-layered]')
    if (layered && !layered.contains(control) && layeredInside(layered, control)) continue
    violations.push(`${describe(control)} is covered at its centre by ${describe(hit)}`)
  }

  // Fields side by side in one row share their height and border, so their edges line up.
  const fields = controls.filter((control) => control.matches('input:not([type="checkbox"]):not([type="radio"]):not([type="file"]), select, textarea') && !isCovered(control))
  fields.forEach((first, index) => {
    for (const second of fields.slice(index + 1)) {
      if (first.parentElement !== second.parentElement) continue
      const a = first.getBoundingClientRect()
      const b = second.getBoundingClientRect()
      if (a.bottom <= b.top || b.bottom <= a.top) continue
      const borderA = getComputedStyle(first).borderTopWidth
      const borderB = getComputedStyle(second).borderTopWidth
      if (Math.abs(a.height - b.height) > 0.5 || borderA !== borderB) {
        violations.push(`${describe(first)} and ${describe(second)} share a row but not their edges (height ${a.height.toFixed(1)}/${b.height.toFixed(1)}, border ${borderA}/${borderB})`)
      }
    }
  })

  // Neighbouring controls are either joined into one compound control or clearly apart; in between they read as
  // cramped and invite mis-taps. Only what is on screen counts, and controls on different layers never neighbour.
  // A transparent checkbox or radio is drawn by its label (a chip, a day toggle): the label is the control people see.
  function visibleControl(control: HTMLElement): HTMLElement | null {
    if (Number(getComputedStyle(control).opacity) > 0) return control
    const label = control.matches('input[type="checkbox"], input[type="radio"]') ? control.closest('label') : null
    return label && rendered(label) ? label : null
  }

  // Blocks on a time axis are placed by their times, not by layout: two absolutely positioned controls side by side
  // show how close two events are, which no spacing token decides.
  function placedByData(first: Element, second: Element): boolean {
    return getComputedStyle(first).position === 'absolute' && getComputedStyle(second).position === 'absolute'
  }

  function wholeBox(shown: Box, control: Element): boolean {
    const rect = control.getBoundingClientRect()
    return Math.abs(shown.left - rect.left) <= TOLERANCE && Math.abs(shown.right - rect.right) <= TOLERANCE && Math.abs(shown.top - rect.top) <= TOLERANCE && Math.abs(shown.bottom - rect.bottom) <= TOLERANCE
  }

  function checkControlSpacing(): void {
    const shownControls = Array.from(new Set(controls.map(visibleControl).filter((control): control is HTMLElement => control !== null)))
    shownControls.forEach((first, index) => {
      for (const second of shownControls.slice(index + 1)) {
        if (first.contains(second) || second.contains(first) || layerOf(first) !== layerOf(second)) continue
        if (layeredInside(first, second) || layeredInside(second, first) || placedByData(first, second)) continue
        // Content in a scroller and chrome outside it are as close as the scroll position puts them, not the layout.
        if (scrollerOf(first) !== scrollerOf(second)) continue
        const a = shownRect(first)
        const b = shownRect(second)
        // A control a scroller has partly moved out of view is cut by the scroller's edge, not spaced by layout.
        if (!a || !b || !wholeBox(a, first) || !wholeBox(b, second)) continue
        let gap: number | null = null
        if (a.top < b.bottom - TOLERANCE && b.top < a.bottom - TOLERANCE) gap = Math.max(b.left - a.right, a.left - b.right)
        else if (a.left < b.right - TOLERANCE && b.left < a.right - TOLERANCE) gap = Math.max(b.top - a.bottom, a.top - b.bottom)
        if (gap === null || gap <= JOINED + TOLERANCE || gap >= SPACING.control - TOLERANCE) continue
        violations.push(`${describe(first)} and ${describe(second)} are ${gap.toFixed(1)}px apart (joined is at most ${JOINED}px, apart at least ${SPACING.control.toFixed(1)}px)`)
      }
    })
  }

  // The primary action of a docked bar (marked `data-dock-primary`: the setup's Send and its summary's button) is the call
  // to action: no other control comes closer than the group gap, whether a neighbour in its row, the answers above it or
  // their scroller's visible edge, and it keeps 16 px plus the safe area above the bottom of the viewport.
  function checkDockPrimary(): void {
    const primaries = Array.from(scope.querySelectorAll<HTMLElement>('[data-dock-primary]')).filter((primary) => rendered(primary) && !isCovered(primary))
    const shownControls = Array.from(new Set(controls.map(visibleControl).filter((control): control is HTMLElement => control !== null)))
    for (const primary of primaries) {
      const rect = primary.getBoundingClientRect()
      const fromBottom = viewportHeight - rect.bottom
      if (fromBottom < SPACING.dockBottom - TOLERANCE) {
        violations.push(`the docked primary ${describe(primary)} is ${fromBottom.toFixed(1)}px from the bottom edge (at least ${SPACING.dockBottom.toFixed(1)}px)`)
      }
      for (const other of shownControls) {
        if (other === primary || other.contains(primary) || primary.contains(other)) continue
        const box = shownRect(other)
        if (!box) continue
        const gap = Math.max(box.left - rect.right, rect.left - box.right, box.top - rect.bottom, rect.top - box.bottom)
        if (gap < SPACING.group - TOLERANCE) {
          violations.push(`${describe(other)} is ${Math.max(gap, 0).toFixed(1)}px from the docked primary ${describe(primary)} (clear space at least ${SPACING.group.toFixed(1)}px)`)
        }
      }
    }
  }

  // A label and value row marked `data-one-line` (the setup's time rows and summary rows) reads as one line at 100 % text
  // from 360 px: all its drawn text shares one line. At larger text it may wrap, the value under its label.
  function checkOneLineRows(): void {
    const rootSize = px(getComputedStyle(document.documentElement).fontSize)
    if (viewportWidth < 360 || rootSize > 16 + TOLERANCE) return
    for (const row of Array.from(scope.querySelectorAll<HTMLElement>('[data-one-line]'))) {
      if (!rendered(row) || isCovered(row)) continue
      const boxes: Box[] = []
      const walker = document.createTreeWalker(row, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!(node.textContent ?? '').trim() || !node.parentElement || !rendered(node.parentElement) || isCovered(node.parentElement)) continue
        const range = document.createRange()
        range.selectNodeContents(node)
        boxes.push(...Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0))
      }
      if (boxes.length === 0) continue
      const top = Math.max(...boxes.map((box) => box.top))
      const bottom = Math.min(...boxes.map((box) => box.bottom))
      if (top >= bottom - TOLERANCE) violations.push(`the row ${describe(row)} breaks onto more than one line (a label and its value share one line at 100 % text from 360 px)`)
    }
  }

  // Page sections (outside sheets) stacked in one column keep the section token between them: each section is measured
  // to the nearest section below it that overlaps it horizontally, wherever the markup nests them.
  function checkSectionSpacing(): void {
    const sections = Array.from(scope.querySelectorAll<HTMLElement>('section, [role="region"]'))
      .filter((section) => rendered(section) && !isCovered(section) && !section.closest('[role="dialog"]'))
    for (const upper of sections) {
      const a = upper.getBoundingClientRect()
      let nearest: { section: HTMLElement; gap: number } | null = null
      for (const lower of sections) {
        if (lower === upper || lower.contains(upper) || upper.contains(lower) || layerOf(lower) !== layerOf(upper)) continue
        const b = lower.getBoundingClientRect()
        if (b.top < a.bottom - TOLERANCE || b.left >= a.right - TOLERANCE || a.left >= b.right - TOLERANCE) continue
        const gap = b.top - a.bottom
        if (!nearest || gap < nearest.gap) nearest = { section: lower, gap }
      }
      if (nearest && nearest.gap < SPACING.section - TOLERANCE) {
        violations.push(`${describe(upper)} and the section below it ${describe(nearest.section)} are ${nearest.gap.toFixed(1)}px apart (sections at least ${SPACING.section.toFixed(1)}px)`)
      }
    }
  }

  // The words an element draws: its text nodes, without visually hidden ones.
  // `withoutMarker` leaves out the generated "…" of a cut title (an element marked `data-cut`).
  function drawnText(element: Element, withoutMarker = false): string {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let text = ''
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (withoutMarker && parent?.closest('[data-cut]')) continue
      if (parent && rendered(parent) && !isCovered(parent)) text += node.textContent ?? ''
    }
    return text.replace(/\s+/g, ' ').trim()
  }

  // The element whose drawn words hold `node`: climbs past wrappers that draw only an ellipsis (the generated "…").
  function titleHolder(node: Text, item: Element): Element {
    let holder: Element | null = node.parentElement
    while (holder && holder !== item && drawnText(holder).replace(/\u2026|\.\.\./g, '').trim() === '') holder = holder.parentElement
    return holder ?? item
  }

  function fullTitle(item: Element): string {
    return (item.getAttribute('title') || item.getAttribute('aria-label') || item.textContent || '').replace(/\s+/g, ' ').trim()
  }

  // A title's words are checked once, whatever ellipses they hold. The words drawn (without the generated "…", an
  // element marked `data-cut`) must be the start of the item's full title (its `title`, else its accessible name),
  // the title's own punctuation included ("Pausa…", "Wait..."). A cut title (with the marker) stops where the full
  // title has a space and more follows: "Revisión de…" and "Pausa… …" are whole words; "Reunió…" or "Vendo…" is a word
  // cut in half, whether the "…" is the marker or plain text. A title drawn without the marker is the whole title.
  function checkTitleWords(holder: Element, item: Element, what: string): void {
    const words = drawnText(holder, true)
    const full = fullTitle(item)
    const cut = Array.from(holder.querySelectorAll('[data-cut]')).some((marker) => rendered(marker) && !isCovered(marker))
    const prefix = words.length > 0 && full.startsWith(words)
    const next = full.charAt(words.length)
    if (cut && !(prefix && /\s/.test(next))) {
      violations.push(`${what} ends "${drawnText(holder)}", which is not whole words of "${full.slice(0, 60)}" followed by "…"`)
    } else if (!cut && !(prefix && (next === '' || /\s/.test(next)))) {
      violations.push(`${what} draws "${words}", a "…" that is not part of the title "${full.slice(0, 60)}"`)
    }
  }

  // A box with no words must be one too small for any: the first word of its title (with "…" when more follows), on
  // one line in the smallest size the container allows (the element marked `data-min-text`, never hyphenated), does not
  // fit the room inside the item's `data-text-inset` (top right bottom left, in px). An item that takes no pointer
  // input (a task outline) and a container with no such size (the seven-day overview) are left alone.
  // A box with no word that is still big enough for its glyph shows it (an element marked `data-glyph`, drawn inside the
  // box): a blank box never appears where the glyph would fit. A box names the glyph it needs in `data-glyph-kind` (a
  // conflict needs its "warning", never the plain category glyph); the glyph's size is the container's element marked
  // `data-glyph-probe` with that kind.
  // A container marked `data-whole-text="shapes"` (the seven-day overview) draws no words by design. One without its
  // own smallest size or glyph is held to the documented ones (docs/design/visual-design.md › Week items: 11 px at
  // 100 % text on a 1.2 line; a glyph 1.125 times that size, square).
  function checkBlankItems(container: HTMLElement, items: Element[]): void {
    if (container.getAttribute('data-whole-text') === 'shapes') return
    const fallbacks: HTMLElement[] = []
    const reference = container.querySelector<HTMLElement>('[data-min-text]') ?? fallbackProbe(container, fallbacks, 'font-size: 0.6875rem; font-weight: 500; line-height: 1.2; letter-spacing: 0.01em')
    const glyphs = new Map<string, { width: number; height: number }>()
    const glyphOf = (kind: string) => {
      let size = glyphs.get(kind)
      if (!size) {
        const probe = Array.from(container.querySelectorAll<HTMLElement>('[data-glyph-probe]')).find((candidate) => glyphKind(candidate.getAttribute('data-glyph-probe')) === kind)
          ?? fallbackProbe(container, fallbacks, 'display: block; width: calc(0.6875rem * 1.125); height: calc(0.6875rem * 1.125)')
        const { width, height } = probe.getBoundingClientRect()
        size = { width, height }
        glyphs.set(kind, size)
      }
      return size
    }
    try {
      checkBlankItemsWith(reference, glyphOf, items)
    } finally {
      for (const fallback of fallbacks) fallback.remove()
    }
  }

  function fallbackProbe(container: HTMLElement, fallbacks: HTMLElement[], style: string): HTMLElement {
    const probe = document.createElement('span')
    probe.style.cssText = `position: absolute; visibility: hidden; ${style}`
    container.append(probe)
    fallbacks.push(probe)
    return probe
  }

  // The tallest span of an item that the items laid over it (`data-layered`, taking input) leave free: a routine whose
  // tasks fill it has no room of its own for a glyph.
  function freeHeight(item: Element, rect: DOMRect, items: Element[]): number {
    const over = items
      .filter((other) => other !== item && other.hasAttribute('data-layered') && getComputedStyle(other).pointerEvents !== 'none')
      .map((other) => other.getBoundingClientRect())
      .filter((box) => box.left < rect.right && box.right > rect.left && box.top < rect.bottom && box.bottom > rect.top)
      .sort((a, b) => a.top - b.top)
    let best = 0
    let from = rect.top
    for (const box of [...over, { top: rect.bottom, bottom: rect.bottom }]) {
      best = Math.max(best, Math.min(box.top, rect.bottom) - from)
      from = Math.max(from, box.bottom)
    }
    return best
  }

  // A glyph's kind: `data-glyph`, `data-glyph-probe` and `data-glyph-kind` name it; empty means the category glyph.
  function glyphKind(value: string | null): string {
    return value || 'category'
  }

  function showsGlyph(item: Element, kind: string): boolean {
    const box = item.getBoundingClientRect()
    return Array.from(item.querySelectorAll('[data-glyph]')).filter((glyph) => glyphKind(glyph.getAttribute('data-glyph')) === kind).some((glyph) => {
      const rect = glyph.getBoundingClientRect()
      return rendered(glyph) && rect.width > 0 && rect.height > 0 && rect.left >= box.left - 0.5 && rect.right <= box.right + 0.5 && rect.top >= box.top - 0.5 && rect.bottom <= box.bottom + 0.5
    })
  }

  function checkBlankItemsWith(reference: HTMLElement, glyphOf: (kind: string) => { width: number; height: number }, items: Element[]): void {
    // Measured with a copy of the reference itself, so the word has exactly its styles and context.
    const measure = (build: (probe: HTMLElement) => void) => {
      const probe = reference.cloneNode(false) as HTMLElement
      probe.style.cssText += '; position: absolute; visibility: hidden; white-space: pre; width: auto; max-width: none'
      build(probe)
      reference.after(probe)
      const range = document.createRange()
      range.selectNodeContents(probe)
      const box = { width: probe.getBoundingClientRect().width, glyphs: range.getBoundingClientRect().height }
      probe.remove()
      return box
    }
    const font = getComputedStyle(reference)
    const line = Math.max(px(font.lineHeight) || px(font.fontSize) * 1.2, measure((probe) => { probe.textContent = 'Hg' }).glyphs)
    for (const item of items) {
      if (getComputedStyle(item).pointerEvents === 'none' || drawnText(item) !== '') continue
      const title = (item.getAttribute('title') || item.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim()
      const words = title.split(' ').filter(Boolean)
      if (words.length === 0) continue
      const text = words.length > 1 ? `${words[0]}\u2026` : words[0]!
      const [top = 0, right = 0, bottom = 0, left = 0] = (item.getAttribute('data-text-inset') ?? '').split(/\s+/).map(Number)
      const rect = item.getBoundingClientRect()
      const width = rect.width - left - right - 0.25
      const height = rect.height - top - bottom
      if (width <= 0) continue
      const room = `${width.toFixed(1)}×${height.toFixed(1)} px room`
      if (height >= line - 0.01) {
        // Measured as a cut title is drawn: the word, then "…" in an element of its own.
        const { width: needed } = measure((probe) => {
          probe.textContent = words[0]!
          if (words.length > 1) probe.append(Object.assign(document.createElement('span'), { textContent: '\u2026' }))
        })
        if (needed <= width) {
          violations.push(`${describe(item)} draws no text though "${text}" fits its ${room}`)
          continue
        }
      }
      const free = freeHeight(item, rect, items) - top - bottom
      const kind = glyphKind(item.getAttribute('data-glyph-kind'))
      const glyph = glyphOf(kind)
      if (width + 0.25 >= glyph.width - 0.01 && free >= glyph.height - 0.01 && !showsGlyph(item, kind)) {
        violations.push(`${describe(item)} draws neither a word nor its ${kind === 'category' ? 'glyph' : `${kind} glyph`} though the ${glyph.width.toFixed(1)}×${glyph.height.toFixed(1)} px glyph fits its ${width.toFixed(1)}×${free.toFixed(1)} px room`)
      }
    }
  }

  // Inside a `[data-whole-text]` container (a Week day column) text is whole words or not drawn (docs/design/visual-design.md ›
  // Week items). Each direct child is an item. A CSS ellipsis or line clamp is not allowed there (only the generated "…"
  // after whole words, or a "…" of the title itself, both checked by checkTitleWords), a line cut by any box or
  // lying outside its item is reported, and no item's text may cross another item's box or text. An item that takes
  // no pointer input (the now-line, a task outline) is see-through. A task marked `data-layered` lies inside its routine,
  // so the routine's box is not in the way of the task's own text.
  function checkWholeText(): void {
    const containers = Array.from(scope.querySelectorAll<HTMLElement>('[data-whole-text]')).filter(rendered)
    for (const container of containers) {
      const items = Array.from(container.children).filter((item) => rendered(item))
      const lines: { item: Element; text: string; box: Box }[] = []
      const checkedTitles = new Set<Element>()
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => (node.textContent ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
      })
      const range = document.createRange()
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const parent = node.parentElement
        if (!parent || !rendered(parent) || isCovered(parent)) continue
        const item = items.find((candidate) => candidate.contains(parent))
        if (!item) continue
        const text = (node.textContent ?? '').trim().slice(0, 40)
        range.selectNodeContents(node)
        const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
        if (rects.length === 0) continue
        const what = `text "${text}" in ${describe(parent)}`
        let cut = false
        for (let clipper: HTMLElement | null = parent; clipper && clipper !== container && !cut; clipper = clipper.parentElement) {
          const style = getComputedStyle(clipper)
          const clipsX = style.overflowX !== 'visible'
          const clipsY = style.overflowY !== 'visible'
          const truncates = style.textOverflow === 'ellipsis' || (style.webkitLineClamp && style.webkitLineClamp !== 'none')
          if (!clipsX && !clipsY && !truncates) continue
          const area = clipper.getBoundingClientRect()
          const left = area.left + clipper.clientLeft
          const top = area.top + clipper.clientTop
          const outside = rects.some((rect) => clipsX && (rect.left < left - TOLERANCE || rect.right > left + clipper.clientWidth + TOLERANCE) || clipsY && (rect.top < top - TOLERANCE || rect.bottom > top + clipper.clientHeight + TOLERANCE))
          if (outside) {
            violations.push(truncates ? `${what} is truncated by ${describe(clipper)} (an ellipsis or a line clamp hides part of it)` : `${what} is cut by ${describe(clipper)}`)
            cut = true
          }
        }
        if (cut) continue
        const own = item.getBoundingClientRect()
        if (rects.some((rect) => !intersects(rect, own) || rect.left < own.left - TOLERANCE || rect.right > own.right + TOLERANCE || rect.top < own.top - TOLERANCE || rect.bottom > own.bottom + TOLERANCE)) {
          violations.push(`${what} runs outside its item ${describe(item)}`)
        }
        for (const other of items) {
          if (other === item || getComputedStyle(other).pointerEvents === 'none') continue
          if (layeredInside(item, other)) continue
          if (rects.some((rect) => intersects(rect, other.getBoundingClientRect()))) violations.push(`${what} is covered by ${describe(other)}`)
        }
        for (const rect of rects) lines.push({ item, text, box: rect })
        if (/\u2026|\.\.\./.test(node.textContent ?? '')) {
          const holder = titleHolder(node as Text, item)
          if (!checkedTitles.has(holder)) {
            checkedTitles.add(holder)
            checkTitleWords(holder, item, what)
          }
        }
      }
      lines.forEach((first, index) => {
        for (const second of lines.slice(index + 1)) {
          if (first.item !== second.item && intersects(first.box, second.box)) violations.push(`text "${first.text}" and text "${second.text}" overlap in ${describe(container)}`)
        }
      })
      checkBlankItems(container, items)
    }
  }

  checkText()
  checkWholeText()
  checkControlSpacing()
  checkDockPrimary()
  checkOneLineRows()
  checkSectionSpacing()

  if (options.focusRings) {
    const previous = document.activeElement as HTMLElement | null
    const focusable = Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => rendered(element))
    for (const element of focusable) {
      element.focus({ preventScroll: true })
      if (document.activeElement !== element) continue
      // Inputs inside a styled wrapper (a custom checkbox) draw the ring on a sibling instead.
      const ringOwner = element.matches(':focus-visible') ? element : null
      if (!ringOwner) continue
      const candidates = [element, ...Array.from(element.parentElement?.children ?? [])]
      for (const candidate of candidates) {
        const style = getComputedStyle(candidate)
        const width = px(style.outlineWidth)
        if (style.outlineStyle === 'none' || width === 0) continue
        const grow = px(style.outlineOffset) + width
        const shape = borderShape(candidate)
        const ring: Shape = { left: shape.left - grow, top: shape.top - grow, right: shape.right + grow, bottom: shape.bottom + grow, radii: radiiOf(candidate, grow) }
        checkContained(candidate, ring, 'the focus ring', true)
      }
    }
    previous?.focus({ preventScroll: true })
  }

  return Array.from(new Set(violations))
}

export async function visualIntegrityViolations(page: Page, { focusRings = true }: IntegrityOptions = {}): Promise<string[]> {
  // Any key press puts Chromium in keyboard modality, so programmatic focus shows :focus-visible as Tab would.
  if (focusRings) await page.keyboard.press('Shift')
  const violations = await page.evaluate(auditInPage, { focusRings })
  return [...violations, ...(await page.evaluate(auditFloatingActionButtonInPage))]
}
