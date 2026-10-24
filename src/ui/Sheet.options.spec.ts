import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, reactive } from 'vue'
import { createI18n } from 'vue-i18n'
import Sheet from './Sheet.vue'

const props = reactive({ open: false, locked: false, largeTargets: false, fullHeight: false, closeLabel: undefined as string | undefined })
const closed = vi.fn()
let app: ReturnType<typeof createApp> | undefined

beforeEach(() => {
  vi.useFakeTimers()
  window.matchMedia = ((query: string) => ({ matches: query.includes('min-width'), addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
  Object.assign(props, { open: false, locked: false, largeTargets: false, fullHeight: false, closeLabel: undefined })
  closed.mockClear()
  const root = document.createElement('div')
  document.body.appendChild(root)
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common: { close: 'Close', cancel: 'Cancel', dragHandle: 'Drag' } } } })
  app = createApp(defineComponent({ render: () => h(Sheet, { title: 'T', ...props, 'onUpdate:open': closed }) }))
  app.use(i18n).mount(root)
})
afterEach(() => { app?.unmount(); vi.useRealTimers(); document.body.innerHTML = '' })

async function show() {
  props.open = true
  await nextTick()
  await vi.advanceTimersByTimeAsync(10)
}

describe('Sheet options for a guided flow', () => {
  it('a locked sheet closes by no path: ✕ is disabled, Escape and the scrim do nothing', async () => {
    props.locked = true
    await show()
    const close = document.querySelector<HTMLButtonElement>('.sheet-close')!
    expect(close.disabled).toBe(true)
    expect(document.querySelector('.sheet-panel')!.getAttribute('aria-busy')).toBe('true')
    document.querySelector('.sheet-panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    document.querySelector<HTMLElement>('.sheet-scrim')!.click()
    expect(closed).not.toHaveBeenCalled()
    props.locked = false
    await nextTick()
    document.querySelector<HTMLElement>('.sheet-scrim')!.click()
    expect(closed).toHaveBeenCalledWith(false)
  })

  it('largeTargets raises the target size for everything inside the panel, and closeLabel renames the ✕', async () => {
    props.largeTargets = true
    props.closeLabel = 'Not now'
    await show()
    expect(document.querySelector('.sheet-panel')!.classList.contains('is-large')).toBe(true)
    expect(document.querySelector('.sheet-close')!.getAttribute('aria-label')).toBe('Not now')
  })

  it('fullHeight marks the panel, and a visual viewport that shrinks sets --vvh on it', async () => {
    const listeners = new Set<() => void>()
    const viewport = { height: 700, addEventListener: (_: string, fn: () => void) => listeners.add(fn), removeEventListener: (_: string, fn: () => void) => listeners.delete(fn) }
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true })
    props.fullHeight = true
    await show()
    const panel = document.querySelector<HTMLElement>('.sheet-panel')!
    expect(panel.classList.contains('is-full')).toBe(true)
    expect(panel.style.getPropertyValue('--vvh')).toBe('700px')
    viewport.height = 360
    listeners.forEach((listener) => listener())
    await nextTick()
    expect(panel.style.getPropertyValue('--vvh')).toBe('360px')
    props.open = false
    await nextTick()
    expect(listeners.size).toBe(0)
    Reflect.deleteProperty(window, 'visualViewport')
  })
})
