import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'
import { ICON_PX, type ColumnMeasure } from './dayColumnPlan'
import { ELLIPSIS, type TextMetrics, type TextRole } from './itemText'

// Measures a day column and the page's fonts for planDayColumn: the column's width, and text widths and line heights
// read from hidden probes that carry the same classes as the drawn text (so the text size, language and font are the
// page's own). Widths are shared by every column: the same text in the same font has the same width.
// Both caches are bounded: a window dragged through hundreds of widths, or text sizes changed back and forth, must not
// grow them for the life of the page. When full, the oldest entry goes (a Map keeps insertion order).
export const WIDTH_CACHE_LIMIT = 2000
export const HYPHEN_CACHE_LIMIT = 500
const widthCache = new Map<string, number>()
const hyphenCache = new Map<string, number | null>()

export function remember<V>(cache: Map<string, V>, key: string, value: V, limit: number): V {
  cache.delete(key)
  cache.set(key, value)
  while (cache.size > limit) cache.delete(cache.keys().next().value!)
  return value
}

const ROLES: readonly TextRole[] = ['blockTitle', 'blockDetail', 'caption', 'taskTitle', 'compact']

function fontKey(style: CSSStyleDeclaration): string {
  return [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily, style.letterSpacing, style.fontVariantNumeric, style.fontKerning].join('|')
}

function snapshot(column: HTMLElement, probes: HTMLElement): ColumnMeasure | null {
  // Lanes are percentages of the column's padding box (its containing block), not of its border box.
  const columnStyle = getComputedStyle(column)
  const width = column.getBoundingClientRect().width - Number.parseFloat(columnStyle.borderLeftWidth) - Number.parseFloat(columnStyle.borderRightWidth)
  if (!(width > 0)) return null
  const fonts = new Map<TextRole, { element: HTMLElement; key: string; lineHeight: number }>()
  for (const role of ROLES) {
    const element = probes.querySelector<HTMLElement>(`[data-role="${role}"]`)
    if (!element) return null
    const style = getComputedStyle(element)
    let lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
    // The small caption size has a line tighter than its glyphs: a line needs the glyphs' own height (ascent and
    // descent), or a box of exactly one line would cut them.
    if (role === 'compact') {
      element.textContent = 'Hg'
      const range = document.createRange()
      range.selectNodeContents(element)
      lineHeight = Math.max(lineHeight, range.getBoundingClientRect().height)
    }
    fonts.set(role, { element, key: fontKey(style), lineHeight })
  }
  const metrics: TextMetrics = {
    width(text, role) {
      const font = fonts.get(role)!
      const key = `${font.key}\u0000${text}`
      let measured = widthCache.get(key)
      if (measured === undefined) {
        font.element.textContent = text
        measured = remember(widthCache, key, font.element.getBoundingClientRect().width, WIDTH_CACHE_LIMIT)
      }
      return measured
    },
    lineHeight: (role) => fonts.get(role)!.lineHeight,
    hyphenatedLines(text, role, width) {
      const font = fonts.get(role)!
      const key = `${font.key}\u0001${Math.round(width * 100)}\u0000${text}`
      let lines = hyphenCache.get(key)
      if (lines === undefined) {
        const probe = probes.querySelector<HTMLElement>(`[data-hyphen="${role}"]`)
        if (!probe) return null
        probe.style.width = `${width}px`
        // Drawn as the view draws it: the words, then "…" in an element of its own.
        if (text.endsWith(ELLIPSIS)) {
          const cut = document.createElement('span')
          cut.textContent = ELLIPSIS
          probe.replaceChildren(document.createTextNode(text.slice(0, -ELLIPSIS.length)), cut)
        } else {
          probe.textContent = text
        }
        const overflows = probe.scrollWidth > probe.clientWidth + 0.5
        lines = remember(hyphenCache, key, overflows ? null : Math.round(probe.getBoundingClientRect().height / font.lineHeight), HYPHEN_CACHE_LIMIT)
      }
      return lines
    },
  }
  // A lead is measured as drawn: the mark or icon with the space after it.
  const lead = (name: string, fallback: number) => probes.querySelector<HTMLElement>(`[data-lead="${name}"]`)?.getBoundingClientRect().width || fallback
  return {
    width,
    metrics,
    markLead: lead('mark', 0),
    glyph: (() => {
      const glyph = probes.querySelector<HTMLElement>('[data-glyph-probe]')?.getBoundingClientRect()
      return glyph ? { width: glyph.width, height: glyph.height } : { width: Infinity, height: Infinity }
    })(),
    iconLead: lead('icon', ICON_PX + metrics.width(' ', 'caption')),
  }
}

// `enabled` is false for the overview, which draws no text.
export function useColumnMeasure(column: Ref<HTMLElement | null>, probes: Ref<HTMLElement | null>, enabled: () => boolean) {
  const measure = shallowRef<ColumnMeasure | null>(null)
  let observer: ResizeObserver | undefined
  let lastWidth = -1

  function refresh(): void {
    if (!enabled() || !column.value || !probes.value) { measure.value = null; return }
    measure.value = snapshot(column.value, probes.value)
  }

  const onFontsLoaded = () => refresh()

  onMounted(() => {
    refresh()
    if (typeof ResizeObserver !== 'undefined' && column.value) {
      observer = new ResizeObserver((entries) => {
        // The column's width changes with the window; the sentinel's size changes with the text size.
        const widthEntry = entries.find((entry) => entry.target === column.value)
        const width = widthEntry ? widthEntry.contentRect.width : lastWidth
        if (widthEntry && width === lastWidth && entries.length === 1) return
        lastWidth = width
        refresh()
      })
      observer.observe(column.value)
      const sentinel = probes.value?.querySelector('[data-sentinel]')
      if (sentinel) observer.observe(sentinel)
    }
    document.fonts?.addEventListener?.('loadingdone', onFontsLoaded)
  })

  onBeforeUnmount(() => {
    observer?.disconnect()
    document.fonts?.removeEventListener?.('loadingdone', onFontsLoaded)
  })

  return measure
}
