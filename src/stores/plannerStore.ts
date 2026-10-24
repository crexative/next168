import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { PlannerDocument, PlannerRepository, SaveResult } from '@/core/model'
import { createEmptyDocument, nextRevision } from '@/repositories/core'

export type PlannerStatus = 'loading' | 'ready' | 'readonly' | 'corrupt' | 'unsupported' | 'error'

export type CommitResult = { ok: true } | { ok: false; reason: string }

// Capabilities the browser adapter has beyond the port; absent on other adapters.
export interface RepositoryExtras {
  writable?: boolean
  onLegacyChange?(onChange: () => void): () => void
  replaceCorrupt?(document: PlannerDocument): Promise<SaveResult>
  peekBackup?(): Promise<PlannerDocument | undefined>
  restoreBackup?(): Promise<SaveResult>
}
export type PlannerRepositoryWithExtras = PlannerRepository & RepositoryExtras

export interface PlannerStoreEnvironment {
  repository: PlannerRepository & RepositoryExtras
  now: () => Date
  newId: () => string
  locale: () => string
  timeZone: () => string
}

let environment: PlannerStoreEnvironment | undefined

export function configurePlannerStore(next: PlannerStoreEnvironment): void {
  environment = next
}

function requireEnvironment(): PlannerStoreEnvironment {
  if (!environment) throw new Error('planner store used before configurePlannerStore')
  return environment
}

export const usePlannerStore = defineStore('planner', () => {
  const document = shallowRef<PlannerDocument | null>(null)
  const status = ref<PlannerStatus>('loading')
  const error = ref<string | null>(null)
  const migratedFrom = ref<number | null>(null)
  const legacyChanged = ref(false)
  const corruptRaw = ref<string | null>(null)
  const corruptReason = ref<string | null>(null)
  const backupAvailable = ref(false)

  let queue: Promise<unknown> = Promise.resolve()
  let stopListening: (() => void)[] = []

  const writable = computed(() => status.value === 'ready')

  function serialized<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task)
    queue = run.catch(() => undefined)
    return run
  }

  async function applyLoad(): Promise<void> {
    const { repository, now, newId, locale, timeZone } = requireEnvironment()
    let result
    try {
      result = await repository.load()
    } catch (failure) {
      status.value = 'error'
      error.value = failure instanceof Error ? failure.message : 'load-failed'
      return
    }
    corruptRaw.value = null
    corruptReason.value = null
    backupAvailable.value = false
    switch (result.kind) {
      case 'ok':
        document.value = result.document
        migratedFrom.value = result.migratedFrom ?? null
        status.value = repository.writable === false ? 'readonly' : 'ready'
        error.value = repository.writable === false ? 'no-web-locks' : null
        break
      case 'empty':
        document.value = createEmptyDocument({ now: now(), locale: locale(), timeZone: timeZone(), idGen: newId })
        status.value = repository.writable === false ? 'readonly' : 'ready'
        error.value = repository.writable === false ? 'no-web-locks' : null
        break
      case 'corrupt':
        document.value = null
        status.value = 'corrupt'
        corruptRaw.value = result.raw
        corruptReason.value = result.reason
        backupAvailable.value = (await repository.peekBackup?.()) !== undefined
        break
      case 'unsupported':
        document.value = null
        status.value = 'unsupported'
        break
    }
  }

  function load(): Promise<void> {
    return serialized(applyLoad)
  }

  function start(): Promise<void> {
    const { repository } = requireEnvironment()
    stopListening.forEach((stop) => stop())
    stopListening = [
      repository.subscribe(() => { void load() }),
      repository.onLegacyChange?.(() => { legacyChanged.value = true }) ?? (() => undefined),
    ]
    return load()
  }

  function commit(mutator: (draft: PlannerDocument) => void): Promise<CommitResult> {
    return serialized(async () => {
      const { repository, now } = requireEnvironment()
      const base = document.value
      if (status.value !== 'ready' || !base) return { ok: false, reason: status.value }

      let candidate: PlannerDocument
      try {
        const draft = structuredClone(base)
        mutator(draft)
        draft.revision = base.revision
        try {
          candidate = nextRevision(draft, { now })
        } catch {
          throw new Error('invalid-document')
        }
      } catch (failure) {
        error.value = failure instanceof Error ? failure.message : 'commit-failed'
        return { ok: false, reason: error.value }
      }

      const saved = await repository.save(candidate, base.revision).catch((failure): SaveResult => ({
        kind: 'error', reason: failure instanceof Error ? failure.message : 'save-failed',
      }))
      if (saved.kind === 'ok') {
        document.value = candidate
        error.value = null
        return { ok: true }
      }
      if (saved.kind === 'conflict') {
        error.value = 'conflict'
        await applyLoad()
        error.value = 'conflict'
        return { ok: false, reason: 'conflict' }
      }
      error.value = saved.reason
      return { ok: false, reason: saved.reason }
    })
  }

  // Resolves once every commit queued so far has settled; the update flow waits on it before reloading.
  function settled(): Promise<void> {
    return queue.then(() => undefined)
  }

  function dismissError(): void {
    error.value = null
  }

  function startFresh(): Promise<CommitResult> {
    return serialized(async () => {
      const { repository, now, newId, locale, timeZone } = requireEnvironment()
      if (status.value !== 'corrupt' || !repository.replaceCorrupt) return { ok: false, reason: status.value }
      const fresh = createEmptyDocument({ now: now(), locale: locale(), timeZone: timeZone(), idGen: newId })
      const saved = await repository.replaceCorrupt(fresh)
      if (saved.kind !== 'ok') {
        error.value = saved.kind === 'error' ? saved.reason : 'conflict'
        return { ok: false, reason: error.value }
      }
      await applyLoad()
      return { ok: true }
    })
  }

  function restoreBackup(): Promise<CommitResult> {
    return serialized(async () => {
      const { repository } = requireEnvironment()
      if (status.value !== 'corrupt' || !repository.restoreBackup) return { ok: false, reason: status.value }
      const restored = await repository.restoreBackup()
      if (restored.kind !== 'ok') {
        error.value = restored.kind === 'error' ? restored.reason : 'conflict'
        return { ok: false, reason: error.value }
      }
      await applyLoad()
      return { ok: true }
    })
  }

  return {
    document, status, error, migratedFrom, legacyChanged, corruptRaw, corruptReason, backupAvailable, writable,
    start, load, commit, settled, dismissError, startFresh, restoreBackup,
  }
})
