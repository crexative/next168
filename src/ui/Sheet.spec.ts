import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, onBeforeUnmount, ref } from 'vue'
import { createI18n } from 'vue-i18n'
import Sheet from './Sheet.vue'
import { openFullScreen } from './sheetStack'

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

  // Nueva tarea starts with typing: a form marks its field data-autofocus, and the sheet focuses that on open.
  it('focuses a field marked data-autofocus instead of the title when it opens', async () => {
    const formOpen = ref(false)
    const root = document.createElement('div')
    document.body.appendChild(root)
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common: { close: 'Close', dragHandle: 'Drag' } } } })
    const form = createApp(defineComponent({
      render: () => h(Sheet, { open: formOpen.value, title: 'New task' }, { default: () => h('input', { 'data-autofocus': '', 'data-testid': 'first' }) }),
    }))
    form.use(i18n).mount(root)
    formOpen.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    expect(document.activeElement?.getAttribute('data-testid')).toBe('first')
    form.unmount()
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

describe('Sheet under a full-screen flow (N5)', () => {
  it('opened while a full-screen flow owns the screen, it renders and takes focus only after the release', async () => {
    const release = openFullScreen()
    open.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(50)
    expect(document.querySelector('.sheet-root')).toBeNull()
    release()
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    expect(document.querySelector('.sheet-root.is-shown')).not.toBeNull()
    expect(document.activeElement?.textContent).toBe('T')
  })

  it('closed while it waits, it never renders', async () => {
    const release = openFullScreen()
    open.value = true
    await nextTick()
    open.value = false
    await nextTick()
    release()
    await nextTick()
    await vi.advanceTimersByTimeAsync(50)
    expect(document.querySelector('.sheet-root')).toBeNull()
  })

  it('a release made when its owner unmounts frees it too', async () => {
    const owner = createApp(defineComponent({
      setup() {
        const release = openFullScreen()
        onBeforeUnmount(release)
        return () => h('div')
      },
    }))
    owner.mount(document.body.appendChild(document.createElement('div')))
    open.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    expect(document.querySelector('.sheet-root')).toBeNull()
    owner.unmount()
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    expect(document.querySelector('.sheet-root.is-shown')).not.toBeNull()
  })
})

describe('Sheet drag on a phone', () => {
  let phoneApp: ReturnType<typeof createApp> | undefined
  const phoneOpen = ref(false)

  beforeEach(() => {
    // Bottom-sheet layout with reduced motion: offsets apply at once, so they can be read synchronously.
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce'),
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia
    HTMLElement.prototype.setPointerCapture ??= () => undefined
    const root = document.createElement('div')
    document.body.appendChild(root)
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common: { close: 'Close', cancel: 'Cancel', dragHandle: 'Drag' } } } })
    phoneApp = createApp(defineComponent({
      render: () => h(Sheet, { open: phoneOpen.value, title: 'T', 'onUpdate:open': (v: boolean) => { phoneOpen.value = v } }),
    }))
    phoneApp.use(i18n).mount(root)
  })

  afterEach(() => {
    phoneApp?.unmount()
    phoneOpen.value = false
  })

  function fire(target: EventTarget, type: string, clientY: number, buttons: number): void {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons, clientY }))
  }

  async function openPhoneSheet(): Promise<{ grab: HTMLElement; panel: HTMLElement }> {
    phoneOpen.value = true
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    return { grab: document.querySelector<HTMLElement>('.sheet-handle')!, panel: document.querySelector<HTMLElement>('.sheet-panel')! }
  }

  it('ignores hover after a mouse press is released outside the header', async () => {
    const { grab, panel } = await openPhoneSheet()
    fire(grab, 'pointerdown', 100, 1)
    fire(document.body, 'pointerup', 100, 0)
    fire(grab, 'pointermove', 130, 0)
    fire(grab, 'pointermove', 160, 0)
    expect(panel.style.transform).toBe('translateY(0px)')
  })

  it('treats moves without the button as hover even when the release was never seen', async () => {
    const { grab, panel } = await openPhoneSheet()
    fire(grab, 'pointerdown', 100, 1)
    fire(grab, 'pointermove', 130, 0)
    fire(grab, 'pointermove', 160, 1)
    expect(panel.style.transform).toBe('translateY(0px)')
  })

  it('settles back when the window loses focus mid-drag', async () => {
    const { grab, panel } = await openPhoneSheet()
    fire(grab, 'pointerdown', 100, 1)
    fire(grab, 'pointermove', 150, 1)
    fire(grab, 'pointermove', 200, 1)
    expect(panel.style.transform).toBe('translateY(50px)')
    window.dispatchEvent(new Event('blur'))
    expect(panel.style.transform).toBe('translateY(0px)')
    fire(grab, 'pointermove', 260, 1)
    expect(panel.style.transform).toBe('translateY(0px)')
    expect(document.querySelector('.sheet-root')).not.toBeNull()
  })
})

// The form header (R_HojaTarea): Cancel · title · the sheet's action, on a phone, where a sheet otherwise has a foot.
describe('Sheet with a form header', () => {
  async function mountForm(props: { grouped?: boolean; locked?: boolean } = {}) {
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => undefined, removeEventListener: () => undefined })) as unknown as typeof window.matchMedia
    const formOpen = ref(true)
    const root = document.createElement('div')
    document.body.appendChild(root)
    const i18n = createI18n({ legacy: false, locale: 'en', messages: { en: { common: { close: 'Close', dragHandle: 'Drag', cancel: 'Cancel' } } } })
    const form = createApp(defineComponent({
      render: () => h(Sheet, { open: formOpen.value, title: 'New task', ...props }, { default: () => h('p', 'body'), action: () => h('button', { type: 'button' }, 'Add') }),
    }))
    form.use(i18n).mount(root)
    await nextTick()
    await vi.advanceTimersByTimeAsync(10)
    return form
  }

  it('has Cancel and the action in its header, and no foot with a second Cancel', async () => {
    const form = await mountForm()
    expect(document.querySelector('[data-testid=sheet-form-header]')).not.toBeNull()
    expect(document.querySelector('.sheet-footer')).toBeNull()
    form.unmount()
  })

  it('a grouped sheet draws its panel as the grouped page', async () => {
    const form = await mountForm({ grouped: true })
    expect(document.querySelector('.sheet-panel')!.classList.contains('is-grouped')).toBe(true)
    form.unmount()
  })

  it('a locked sheet cannot be cancelled from its header', async () => {
    const form = await mountForm({ locked: true })
    expect(document.querySelector<HTMLButtonElement>('[data-testid=sheet-cancel]')!.disabled).toBe(true)
    form.unmount()
  })
})
