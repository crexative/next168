// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, ref, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, newTestId } from '@/repositories/testSupport'
import registerShare from './index'
import ShareWeekSheet from './ShareWeekSheet.vue'
import { overlapDocument, sentinelDocument } from './testFixtures'

const NOW = '2026-10-21T10:15:00.000Z'
let app: App | undefined
let host: HTMLElement
const files = new Map<string, File>()
const shared: ShareData[] = []
let blobResult: () => Blob | null = () => new Blob(['png'], { type: 'image/png' })

function fakeContext() {
  return {
    fillStyle: '', strokeStyle: '', lineWidth: 1, font: '12px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', direction: 'ltr',
    fillRect() {}, beginPath() {}, roundRect() {}, fill() {}, stroke() {}, fillText() {},
    measureText(text: string) { return { width: text.length * 20 } },
  }
}

async function mount(seed: PlannerDocument) {
  vi.setSystemTime(new Date(NOW))
  const pinia = createPinia()
  setActivePinia(pinia)
  const repos = createTestRepositories()
  configurePlannerStore({ repository: repos.planner, now: () => new Date(NOW), newId: newTestId, locale: () => 'en', timeZone: () => 'UTC' })
  const store = usePlannerStore()
  await repos.planner.save(seed, 0)
  await store.load()
  registerShare()
  host = document.createElement('div')
  document.body.appendChild(host)
  const open = ref(true)
  app = createApp({ render: () => h(ShareWeekSheet, { open: open.value, 'onUpdate:open': (value: boolean) => { open.value = value } }) }).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  return { store, open }
}

const preview = () => document.querySelector<HTMLImageElement>('[data-testid="share-preview"]')
const primary = () => document.querySelector<HTMLButtonElement>('[data-testid="share-primary"]')!
const measures = () => performance.getEntriesByType('measure').filter((entry) => entry.name.startsWith('share:')) as PerformanceMeasure[]

async function loadPreview(previousSrc?: string): Promise<HTMLImageElement> {
  await vi.waitFor(() => expect(preview()?.src).toMatch(/^blob:/))
  if (previousSrc) await vi.waitFor(() => expect(preview()!.src).not.toBe(previousSrc))
  const image = preview()!
  image.dispatchEvent(new Event('load'))
  await nextTick()
  return image
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  files.clear()
  shared.length = 0
  blobResult = () => new Blob(['png'], { type: 'image/png' })
  let next = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation((file) => {
    const url = `blob:share/${++next}`
    files.set(url, file as File)
    return url
  })
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => fakeContext() as never)
  HTMLCanvasElement.prototype.toBlob = function (callback: BlobCallback) { setTimeout(() => callback(blobResult()), 0) }
  Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true })
  Object.defineProperty(navigator, 'share', { configurable: true, value: (data: ShareData) => { shared.push(data); return Promise.resolve() } })
})

afterEach(() => {
  app?.unmount()
  host?.remove()
  app = undefined
  document.body.innerHTML = ''
  i18n.global.locale.value = 'en'
  vi.restoreAllMocks()
  vi.useRealTimers()
  performance.clearMarks()
  performance.clearMeasures()
})

describe('share sheet', () => {
  // T-1B-06 / T-1B-09: the File shown is the File shared, and one text serves as alt, selectable text and share text.
  it('shares the previewed File with the summary text that is also its alt', async () => {
    await mount(overlapDocument())
    const image = await loadPreview()
    expect(primary().disabled).toBe(false)
    const text = document.querySelector('[data-testid="share-summary-text"]')!.textContent
    expect(text).toContain('465 h because some overlap')
    expect(image.alt).toBe(text)
    primary().click()
    expect(shared).toHaveLength(1)
    expect(shared[0]!.files![0]).toBe(files.get(image.src))
    expect(shared[0]!.text).toBe(text)
    expect(shared[0]!.files![0]!.name).toBe('next168-my-typical-week.png')
  })

  it('disables the actions in the same tick the names switch changes', async () => {
    await mount(sentinelDocument())
    await loadPreview()
    const names = document.querySelector<HTMLInputElement>('[data-testid="share-names"]')!
    expect(names.getAttribute('role')).toBe('switch')
    expect(names.getAttribute('aria-checked')).toBe('false')
    names.click()
    await nextTick()
    expect(names.getAttribute('aria-checked')).toBe('true')
    expect(primary().disabled).toBe(true)
    primary().click()
    expect(shared).toHaveLength(0)
  })

  // T-1B-10: the measurements of one open-to-ready cycle.
  it('records paint, encode and time-to-ready once per generation, with their details', async () => {
    await mount(sentinelDocument())
    const first = await loadPreview()
    const byName = (name: string) => measures().filter((entry) => entry.name === name)
    for (const name of ['share:time-to-ready', 'share:paint', 'share:encode']) expect(byName(name), name).toHaveLength(1)
    expect(byName('share:time-to-ready')[0]!.detail).toMatchObject({ format: 'story', includeNames: false, categories: 3, generation: 1, longTasks: 'unsupported' })
    expect(byName('share:paint')[0]!.detail).toMatchObject({ format: 'story', includeNames: false, categories: 3, generation: 1 })
    expect(performance.getEntriesByName('share:open', 'mark')).toHaveLength(1)

    document.querySelector<HTMLButtonElement>('[role="radio"]:not([aria-checked="true"])')!.click()
    await loadPreview(first.src)
    expect(byName('share:time-to-ready')).toHaveLength(2)
    expect(byName('share:time-to-ready')[1]!.detail).toMatchObject({ format: 'square', generation: 2 })
    expect(performance.getEntriesByName('share:change', 'mark')).toHaveLength(1)
    primary().click()
    expect(performance.getEntriesByName('share:handoff', 'mark')).toHaveLength(1)
  })

  it('says it could not make the image and keeps the actions disabled when encoding yields nothing', async () => {
    blobResult = () => null
    await mount(sentinelDocument())
    await vi.waitFor(() => expect(document.querySelector('[data-testid="share-failed"]')).not.toBeNull())
    expect(document.querySelector('[data-testid="share-failed"]')!.textContent).toBe(i18n.global.t('share.failed', { reason: 'encode' }))
    expect(performance.getEntriesByName('share:encode-failed', 'mark')).toHaveLength(1)
    expect(preview()).toBeNull()
    expect(primary().disabled).toBe(true)
    expect(document.querySelector<HTMLButtonElement>('[data-testid="share-download"]')!.disabled).toBe(true)
  })
})
