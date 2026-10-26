import { computed, onScopeDispose, ref, shallowRef, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import type { ShareFormat } from './layout'
import type { ShareTheme } from './palette'
import type { ShareSummary } from './shareSummary'

// Everything the image depends on. Replacing the workspace (an import, a delete-all, a reset) changes workspaceId or
// the purge epoch even at the same revision, so a prepared image of the old planner is never handed out.
export interface ShareInputs {
  workspaceId: string
  purgeEpoch: number | 'none'
  revision: number
  includeNames: boolean
  format: ShareFormat
  theme: ShareTheme
  locale: string
  brandName: string
  publicUrl?: string
}

export function shareArtifactKey(inputs: ShareInputs): string {
  const { workspaceId, purgeEpoch, revision, includeNames, format, theme, locale, brandName, publicUrl } = inputs
  return `${workspaceId}:${purgeEpoch}:${revision}:${includeNames}:${format}:${theme}:${locale}:${brandName}:${publicUrl ?? ''}`
}

export interface ShareSteps<Canvas> {
  summarize(inputs: ShareInputs): ShareSummary
  paint(summary: ShareSummary, inputs: ShareInputs): Canvas
  encode(canvas: Canvas): Promise<Blob | null>
  fileName(inputs: ShareInputs): string
}

export interface ShareArtifact {
  key: string
  generation: number
  file: File
  url: string
}

export interface ShareMeasureDetail {
  format: ShareFormat
  includeNames: boolean
  categories: number
  generation: number
  longTasks?: number | 'unsupported'
}

export interface ShareArtifactEnvironment {
  performance: Pick<Performance, 'mark' | 'measure'>
  createObjectURL(file: File): string
  revokeObjectURL(url: string): void
  // Lets the sheet draw its "preparing" state before the synchronous paint runs.
  yieldToRenderer(): Promise<void>
  longTasks?(): { stop(): number } | undefined
}

// Counts long tasks (Chromium) from now until stop(); undefined where the browser cannot observe them.
function observeLongTasks(): { stop(): number } | undefined {
  if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes('longtask')) return undefined
  let count = 0
  const observer = new PerformanceObserver((list) => { count += list.getEntries().length })
  observer.observe({ type: 'longtask' })
  return { stop: () => { observer.disconnect(); return count } }
}

const browserEnvironment = (): ShareArtifactEnvironment => ({
  performance,
  createObjectURL: (file) => URL.createObjectURL(file),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  yieldToRenderer: () => new Promise((resolve) => setTimeout(resolve, 0)),
  longTasks: observeLongTasks,
})

export interface UseShareArtifact {
  key: ComputedRef<string | null>
  // The artifact for the current inputs, or null while it is being prepared: the only one that may be handed out.
  ready: ShallowRef<ShareArtifact | null>
  // What the preview shows: the latest published artifact, kept (dimmed by the sheet) while a newer one is prepared,
  // so the preview does not flash empty. Its URL is revoked when it is replaced and when the sheet closes.
  preview: ShallowRef<ShareArtifact | null>
  // Set when the image could not be encoded; the actions stay disabled.
  failed: Ref<boolean>
  // The preview <img> loaded this artifact and the actions are enabled.
  markReady(artifact: ShareArtifact): void
  markHandoff(): void
}

interface Generation {
  number: number
  start: PerformanceMark
  detail: ShareMeasureDetail
  longTasks?: { stop(): number }
  readyMarked: boolean
}

// A generation-bound PNG File and its preview URL. Any change of the inputs clears `ready` in the same tick (so the
// actions disable at once) and starts a new generation; only the latest generation may publish, so a late image of
// older inputs (names on, another planner) is discarded. The File shown in the preview is the File handed out.
export function useShareArtifact<Canvas>(source: () => ShareInputs | null, steps: ShareSteps<Canvas>, environment: ShareArtifactEnvironment = browserEnvironment()): UseShareArtifact {
  const { performance: perf } = environment
  const key = computed(() => {
    const inputs = source()
    return inputs ? shareArtifactKey(inputs) : null
  })
  const ready = shallowRef<ShareArtifact | null>(null)
  const preview = shallowRef<ShareArtifact | null>(null)
  const failed = ref(false)
  let generation = 0
  let current: Generation | undefined

  function invalidate(): void {
    ready.value = null
    failed.value = false
    current?.longTasks?.stop()
    current = undefined
  }

  function show(artifact: ShareArtifact | null): void {
    if (preview.value) environment.revokeObjectURL(preview.value.url)
    preview.value = artifact
  }

  function measure(name: string, start: PerformanceMark, end: PerformanceMark, detail: ShareMeasureDetail): void {
    perf.measure(name, { start: start.startTime, end: end.startTime, detail })
  }

  async function build(inputs: ShareInputs, run: Generation): Promise<void> {
    const live = () => run.number === generation
    await environment.yieldToRenderer()
    if (!live()) return
    const summary = steps.summarize(inputs)
    run.detail.categories = summary.categories.length
    const summarized = perf.mark('share:summary', { detail: run.detail })
    let canvas: Canvas
    try {
      canvas = steps.paint(summary, inputs)
    } catch {
      failed.value = true
      return
    }
    const painted = perf.mark('share:painted', { detail: run.detail })
    measure('share:paint', summarized, painted, run.detail)
    let blob: Blob | null = null
    try {
      blob = await steps.encode(canvas)
    } catch {
      blob = null
    }
    if (!live()) return
    if (!blob) {
      perf.mark('share:encode-failed', { detail: run.detail })
      failed.value = true
      return
    }
    const encoded = perf.mark('share:encoded', { detail: run.detail })
    measure('share:encode', painted, encoded, run.detail)
    const file = new File([blob], steps.fileName(inputs), { type: 'image/png' })
    const artifact = { key: shareArtifactKey(inputs), generation: run.number, file, url: environment.createObjectURL(file) }
    show(artifact)
    ready.value = artifact
  }

  watch(key, (next, previous) => {
    const opened = previous === null || previous === undefined
    invalidate()
    generation += 1
    const inputs = source()
    if (next === null || !inputs) {
      show(null)
      return
    }
    const detail: ShareMeasureDetail = { format: inputs.format, includeNames: inputs.includeNames, categories: 0, generation }
    current = { number: generation, start: perf.mark(opened ? 'share:open' : 'share:change', { detail }), detail, readyMarked: false, longTasks: environment.longTasks?.() }
    void build(inputs, current)
  }, { flush: 'sync', immediate: true })

  function markReady(artifact: ShareArtifact): void {
    const run = current
    if (!run || run.readyMarked || ready.value !== artifact || artifact.key !== key.value) return
    run.readyMarked = true
    const detail = { ...run.detail, longTasks: run.longTasks ? run.longTasks.stop() : 'unsupported' as const }
    run.longTasks = undefined
    const end = perf.mark('share:ready', { detail })
    measure('share:time-to-ready', run.start, end, detail)
  }

  function markHandoff(): void {
    perf.mark('share:handoff', { detail: current?.detail })
  }

  onScopeDispose(() => {
    generation += 1
    invalidate()
    show(null)
  })

  return { key, ready, preview, failed, markReady, markHandoff }
}
