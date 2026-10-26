import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import Sheet from './Sheet.vue'
import { anySheetOpen } from './sheetStack'

// Integration CI (run 40277814067): a sheet unmounted while its close animation was pending (a test ending, a page
// going away) finished closing afterwards and touched the document after the test environment was torn down
// ("document is not defined" at sheetStack.ts, from Sheet.vue's close path). Once unmounted, a sheet does nothing more.
const open = ref(false)
let app: ReturnType<typeof createApp> | undefined
let opener: HTMLButtonElement

beforeEach(() => {
  vi.useFakeTimers()
  // Centered layout: the exit is a fixed fade (a timer), as in Sheet.spec.ts.
  window.matchMedia = ((query: string) => ({
    matches: query.includes('min-width'),
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
  open.value = false
  opener = document.createElement('button')
  document.body.appendChild(opener)
  opener.focus()
  const root = document.createElement('div')
  document.body.appendChild(root)
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common: { close: 'Close', dragHandle: 'Drag' } } } })
  app = createApp(defineComponent({
    render: () => h(Sheet, { open: open.value, title: 'T', 'onUpdate:open': (value: boolean) => { open.value = value } }),
  }))
  app.use(i18n).mount(root)
})

afterEach(() => {
  app?.unmount()
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('a sheet unmounted while it closes', () => {
  it('leaves the list of sheets and the page flag at once, and touches nothing when its animation would have ended', async () => {
    open.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    expect(document.documentElement.dataset.sheetOpen).toBe('')
    open.value = false
    await nextTick()
    app!.unmount()
    app = undefined
    expect(anySheetOpen()).toBe(false)
    expect(document.documentElement.dataset.sheetOpen).toBeUndefined()
    // Something else has focus now; the unmounted sheet's pending close must not take it back to its opener.
    const elsewhere = document.createElement('input')
    document.body.appendChild(elsewhere)
    elsewhere.focus()
    document.body.removeChild(elsewhere)
    const flag = vi.spyOn(document.documentElement, 'dataset', 'get')
    const focus = vi.spyOn(opener, 'focus')
    await vi.advanceTimersByTimeAsync(1000)
    expect(focus).not.toHaveBeenCalled()
    expect(flag).not.toHaveBeenCalled()
  })

  it('touches nothing after unmount when it was unmounted while open', async () => {
    open.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    app!.unmount()
    app = undefined
    expect(anySheetOpen()).toBe(false)
    expect(document.documentElement.dataset.sheetOpen).toBeUndefined()
    const flag = vi.spyOn(document.documentElement, 'dataset', 'get')
    await vi.advanceTimersByTimeAsync(1000)
    expect(flag).not.toHaveBeenCalled()
  })
})
