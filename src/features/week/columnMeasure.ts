import { onBeforeUnmount, onMounted, shallowRef, type Ref } from 'vue'
import { ICON_PX, type ColumnMeasure } from './dayColumnPlan'
import type { TextMetrics, TextRole } from './itemText'

// Measures a day column and the page's fonts for planDayColumn: the column's width, and text widths and line heights
// read from hidden probes that carry the same classes as the drawn text (so the text size, language and font are the
// page's own). Widths are shared by every column: the same text in the same font has the same width.
const widthCache = new Map<string, number>()

const ROLES: readonly TextRole[] = ['blockTitle', 'blockDetail', 'caption', 'taskTitle']

function fontKey(style: CSSStyleDeclaration): string {
  return [style.fontStyle, style.fontWeight, style.fontSize, style.fontFamily, style.letterSpacing, style.fontVariantNumeric, style.fontKerning].join('|')
}

function snapshot(column: HTMLElement, probes: HTMLElement): ColumnMeasure | null {
  const width = column.getBoundingClientRect().width
  if (!(width > 0)) return null
  const fonts = new Map<TextRole, { element: HTMLElement; key: string; lineHeight: number }>()
  for (const role of ROLES) {
    const element = probes.querySelector<HTMLElement>(`[data-role="${role}"]`)
    if (!element) return null
    const style = getComputedStyle(element)
    const lineHeight = Number.parseFloat(style.lineHeight) || Number.parseFloat(style.fontSize) * 1.2
    fonts.set(role, { element, key: fontKey(style), lineHeight })
  }
  const metrics: TextMetrics = {
    width(text, role) {
      const font = fonts.get(role)!
      const key = `${font.key}\u0000${text}`
      let measured = widthCache.get(key)
      if (measured === undefined) {
        font.element.textContent = text
        measured = font.element.getBoundingClientRect().width
        widthCache.set(key, measured)
      }
      return measured
    },
    lineHeight: (role) => fonts.get(role)!.lineHeight,
  }
  const mark = probes.querySelector<HTMLElement>('[data-lead="mark"]')
  const markWidth = mark ? mark.getBoundingClientRect().width + Number.parseFloat(getComputedStyle(mark).marginInlineEnd || '0') : 0
  return {
    width,
    metrics,
    markLead: markWidth + metrics.width(' ', 'blockTitle'),
    iconLead: ICON_PX + metrics.width(' ', 'caption'),
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
