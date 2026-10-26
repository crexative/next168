import { afterEach, describe, expect, it } from 'vitest'
import { effectScope, reactive } from 'vue'
import type { ShareSummary } from './shareSummary'
import { shareArtifactKey, useShareArtifact, type ShareArtifactEnvironment, type ShareInputs } from './useShareArtifact'

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

// A builder whose encodes the test resolves by hand, in any order. Each PNG's bytes name the inputs it was made from.
function harness(initial: Partial<ShareInputs> = {}) {
  const inputs = reactive<ShareInputs>({
    workspaceId: 'ws-a', purgeEpoch: 1, revision: 4, includeNames: true, format: 'story', theme: 'light', locale: 'en', brandName: 'Weeklid', ...initial,
  })
  const open = reactive({ value: true })
  const pending = new Map<string, ReturnType<typeof deferred<Blob | null>>>()
  const revoked: string[] = []
  let urls = 0
  const environment: ShareArtifactEnvironment = {
    performance,
    createObjectURL: () => `blob:test/${++urls}`,
    revokeObjectURL: (url) => { revoked.push(url) },
    yieldToRenderer: () => Promise.resolve(),
  }
  const scope = effectScope()
  const artifact = scope.run(() => useShareArtifact(() => (open.value ? { ...inputs } : null), {
    summarize: (): ShareSummary => ({ brandName: 'Weeklid', assignedHours: 0, unassignedHours: 168, plannedTotalHours: 0, overlap: false, categories: [] }),
    paint: (_summary, current) => shareArtifactKey(current),
    encode: (key) => {
      const wait = deferred<Blob | null>()
      pending.set(key, wait)
      return wait.promise
    },
    fileName: () => 'weeklid-my-typical-week.png',
  }, environment))!
  async function resolve(key: string): Promise<void> {
    await flush()
    pending.get(key)!.resolve(new Blob([key], { type: 'image/png' }))
    await flush()
  }
  return { inputs, open, artifact, resolve, revoked, stop: () => scope.stop() }
}

const bytesOf = async (file: File | undefined) => (file ? file.text() : undefined)
let stop: (() => void) | undefined
afterEach(() => { stop?.(); performance.clearMarks(); performance.clearMeasures() })

// T-1B-06: a prepared image is bound to exactly the inputs on screen.
describe('useShareArtifact', () => {
  it('drops the image in the same tick the names switch changes, and only the latest image publishes', async () => {
    const run = harness()
    stop = run.stop
    const keyA = run.artifact.key.value!
    await run.resolve(keyA)
    expect(await bytesOf(run.artifact.ready.value?.file)).toBe(keyA)

    run.inputs.includeNames = false
    expect(run.artifact.ready.value).toBeNull()
    const keyB = run.artifact.key.value!
    run.inputs.includeNames = true
    run.inputs.includeNames = false
    expect(run.artifact.key.value).toBe(keyB)

    // Out of order: B (names off) resolves first, then a stale names-on image arrives late.
    run.inputs.includeNames = true
    const keyC = run.artifact.key.value!
    run.inputs.includeNames = false
    await run.resolve(run.artifact.key.value!)
    const published = run.artifact.ready.value
    expect(await bytesOf(published?.file)).toBe(keyB)
    await run.resolve(keyC)
    expect(run.artifact.ready.value).toBe(published)
    expect(await bytesOf(run.artifact.ready.value?.file)).not.toContain(':true:')
    expect(run.artifact.preview.value).toBe(published)
  })

  it.each([
    ['another workspace at the same revision', (inputs: ShareInputs) => { inputs.workspaceId = 'ws-b' }],
    ['a delete-all to a fresh planner at the same revision (purge epoch only)', (inputs: ShareInputs) => { inputs.purgeEpoch = 2 }],
  ])('drops the image of the old planner on %s, and its late image never publishes', async (_name, replace) => {
    const run = harness()
    stop = run.stop
    await run.resolve(run.artifact.key.value!)
    expect(run.artifact.ready.value).not.toBeNull()

    run.inputs.includeNames = false
    const old = run.artifact.key.value!
    // The old planner's image is being encoded when the planner is replaced.
    await flush()
    replace(run.inputs)
    expect(run.artifact.ready.value).toBeNull()
    expect(run.artifact.key.value).not.toBe(old)
    await run.resolve(old)
    expect(run.artifact.ready.value).toBeNull()
    await run.resolve(run.artifact.key.value!)
    expect(await bytesOf(run.artifact.ready.value?.file)).toBe(run.artifact.key.value)
  })

  it('revokes the preview URL when it is replaced and when the sheet closes', async () => {
    const run = harness()
    stop = run.stop
    await run.resolve(run.artifact.key.value!)
    const first = run.artifact.preview.value!.url
    run.inputs.format = 'square'
    expect(run.artifact.preview.value?.url).toBe(first)
    expect(run.revoked).toEqual([])
    await run.resolve(run.artifact.key.value!)
    expect(run.revoked).toEqual([first])
    const second = run.artifact.preview.value!.url
    run.open.value = false
    expect(run.artifact.preview.value).toBeNull()
    expect(run.revoked).toEqual([first, second])
  })
})
