import type { Page } from '@playwright/test'

export type IntegrityOptions = {
  // Also focus every control the way a keyboard user would and check its focus ring.
  focusRings?: boolean
}

// Keep this function self-contained: Playwright serializes it into the page.
export function auditInPage(options: { focusRings: boolean }): string[] {
  const TOLERANCE = 0.75
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

  // The nearest fixed or sticky layer an element floats in; content scrolls underneath such layers.
  function layerOf(element: Element): Element | null {
    for (let node: Element | null = element; node; node = node.parentElement) {
      if (/fixed|sticky/.test(getComputedStyle(node).position)) return node
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

  function checkText(): void {
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => (node.textContent ?? '').trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    })
    const blocks = new Set<HTMLElement>()
    const range = document.createRange()
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement
      if (!parent || parent.closest('option, script, style, svg, select, textarea') || !rendered(parent) || isCovered(parent)) continue
      blocks.add(blockOf(parent))
      range.selectNodeContents(node)
      const lines = Array.from(range.getClientRects()).filter((line) => line.width > 0 && line.height > 0)
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

  const controls = Array.from(scope.querySelectorAll<HTMLElement>(CONTROL)).filter((control) => rendered(control) && !isCovered(control))

  for (const control of controls) {
    const rect = control.getBoundingClientRect()
    checkContained(control, { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, radii: radiiOf(control, 0) }, 'the border box', false)
    if (control instanceof HTMLSelectElement) checkSelect(control)
    if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) checkInput(control)
  }

  const formControls = controls.filter((control) => control.matches(FORM_CONTROL) && Number(getComputedStyle(control).opacity) > 0)
  // Only the part a scroll container shows can overlap: a button scrolled under a sheet's footer is out of view.
  function shownPart(control: Element): Box {
    const rect = control.getBoundingClientRect()
    const box = scrolledInto(control)
    return { left: Math.max(rect.left, box.left), top: Math.max(rect.top, box.top), right: Math.min(rect.right, box.right), bottom: Math.min(rect.bottom, box.bottom) }
  }
  formControls.forEach((first, index) => {
    for (const second of formControls.slice(index + 1)) {
      if (first.contains(second) || second.contains(first) || layerOf(first) !== layerOf(second)) continue
      const [a, b] = [shownPart(first), shownPart(second)]
      if (a.right <= a.left || a.bottom <= a.top || b.right <= b.left || b.bottom <= b.top) continue
      if (intersects(a, b)) violations.push(`${describe(first)} overlaps ${describe(second)}`)
    }
  })

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

  checkText()

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
  return page.evaluate(auditInPage, { focusRings })
}
