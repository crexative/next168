import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import Sheet from './Sheet.vue'

const open = ref(false)
let app: ReturnType<typeof createApp> | undefined

beforeEach(() => {
  vi.useFakeTimers()
  // Centered layout: the exit is a fixed fade, which keeps the timing deterministic.
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  open.value = false
  const root = document.createElement('div')
  document.body.appendChild(root)
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common: { close: 'Close', dragHandle: 'Drag' } } } })
  app = createApp(defineComponent({
    render: () => h(Sheet, { open: open.value, title: 'T', 'onUpdate:open': (v: boolean) => { open.value = v } }),
  }))
  app.use(i18n).mount(root)
})

afterEach(() => {
  app?.unmount()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('Sheet', () => {
  it('keeps a reopened sheet rendered when the earlier close animation finishes', async () => {
    open.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    open.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(50)
    open.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(document.querySelector('.sheet-root')).not.toBeNull()
    expect(document.querySelector('.sheet-root.is-shown')).not.toBeNull()
  })

  it('focuses the title, not the close button, when it opens', async () => {
    open.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    expect(document.activeElement?.tagName).toBe('H2')
    expect(document.activeElement?.textContent).toBe('T')
  })

  it('still removes the sheet after an uninterrupted close', async () => {
    open.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    open.value = false
    await nextTick()
    await vi.advanceTimersByTimeAsync(500)
    expect(document.querySelector('.sheet-root')).toBeNull()
  })
})
