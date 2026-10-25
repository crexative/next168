import { computed, ref, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import type { PlannerDocument, PlannerRepository, SaveResult } from '@/core/model'
import { createEmptyDocument, nextRevision } from '@/repositories/core'
import { failureReason, isStorageFailure } from '@/repositories/storageCommit'

export type PlannerStatus = 'loading' | 'ready' | 'readonly' | 'corrupt' | 'unsupported' | 'error'

export type CommitResult = { ok: true } | { ok: false; reason: string }

// Capabilities the browser adapter has beyond the port; absent on other adapters.
export interface RepositoryExtras {
  writable?: boolean
  onLegacyChange?(onChange: () => void): () => void
  replaceCorrupt?(document: PlannerDocument): Promise<SaveResult>
  peekBackup?(): Promise<PlannerDocument | undefined>
  restoreBackup?(): Promise<SaveResult>
  // Browser only: replaces the planner and removes everything else it stored, in one commit-lock hold.
  deleteAll?(fresh: PlannerDocument, expectedRevision: number): Promise<SaveResult>
  // Browser only: a save refused when a delete-all happened since `purgeEpoch` was read.
  saveAtEpoch?(document: PlannerDocument, expectedRevision: number, purgeEpoch: number): Promise<SaveResult>
  // Browser only: a save refused unless storage still holds exactly what the caller opened on (and the same purge epoch).
  saveGuarded?(document: PlannerDocument, expectedRevision: number, guard: { purgeEpoch?: number; storedFingerprint?: string }): Promise<SaveResult>
  // Browser only, synchronous: the purge epoch this tab last loaded.
  knownPurgeEpoch?(): number | undefined
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

// The repository of the current mode (browser or companion), for read-backs outside the store.
export function activePlannerRepository(): PlannerRepositoryWithExtras {
  return requireEnvironment().repository
}

export interface CommitOptions {
  // Calendar writes pass the purge epoch they started under, so they never land after a delete-all.
  purgeEpoch?: number
  // A flow that opened on a stored document (or on proven-empty storage, 'absent') passes what it opened on; the write
  // is refused inside the commit lock unless storage still holds exactly that.
  expect?: { storedFingerprint: string; purgeEpoch?: number }
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
  // True after a write failed on storage: the error screen then says the last change was not saved.
  const lastChangeLost = ref(false)
  // False until a load found a stored document or a commit succeeded: a proven-empty load is "nothing stored yet".
  const stored = ref(false)

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
    const unsaved = !stored.value && (status.value === 'ready' || status.value === 'readonly') ? document.value : null
    let result
    try {
      result = await repository.load()
    } catch (failure) {
      // The document already shown (if any) stays in memory, so the error screen can still export it.
      status.value = 'error'
      error.value = failureReason(failure)
      return
    }
    corruptRaw.value = null
    corruptReason.value = null
    backupAvailable.value = false
    lastChangeLost.value = false
    switch (result.kind) {
      case 'ok':
        stored.value = true
        document.value = result.document
        migratedFrom.value = result.migratedFrom ?? null
        status.value = repository.writable === false ? 'readonly' : 'ready'
        error.value = repository.writable === false ? 'no-web-locks' : null
        break
      case 'empty':
        // The same unsaved planner while nothing is stored: a prompt copied for an AI or a proposal made against it
        // stays valid across re-checks. Storage's own unsaved planner (made by a proposal in any tab) comes first.
        document.value = result.document ?? (unsaved ?? createEmptyDocument({ now: now(), locale: locale(), timeZone: timeZone(), idGen: newId }))
        stored.value = false
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

  function candidateFrom(base: PlannerDocument, mutator: (draft: PlannerDocument) => void): PlannerDocument {
    const draft = structuredClone(base)
    mutator(draft)
    draft.revision = base.revision
    try {
      return nextRevision(draft, { now: requireEnvironment().now })
    } catch {
      throw new Error('invalid-document')
    }
  }

  // A failure of the storage itself blocks editing: the error screen replaces the views until a reload works.
  function reportStorageFailure(reason: string): void {
    error.value = reason
    if (!isStorageFailure(reason)) return
    status.value = 'error'
    lastChangeLost.value = true
  }

  function persist(
    mutator: (draft: PlannerDocument) => void,
    write: (repository: PlannerRepositoryWithExtras, candidate: PlannerDocument, expectedRevision: number) => Promise<SaveResult>,
  ): Promise<CommitResult> {
    return serialized(async () => {
      const { repository } = requireEnvironment()
      const base = document.value
      if (status.value !== 'ready' || !base) return { ok: false, reason: status.value }

      let candidate: PlannerDocument
      try {
        candidate = candidateFrom(base, mutator)
      } catch (failure) {
        error.value = failure instanceof Error ? failure.message : 'commit-failed'
        return { ok: false, reason: error.value }
      }

      const saved = await write(repository, candidate, base.revision).catch((failure): SaveResult => ({
        kind: 'error', reason: failure instanceof Error ? failure.message : 'save-failed',
      }))
      if (saved.kind === 'ok') {
        document.value = candidate
        stored.value = true
        error.value = null
        return { ok: true }
      }
      if (saved.kind === 'conflict') {
        error.value = 'conflict'
        await applyLoad()
        error.value = 'conflict'
        return { ok: false, reason: 'conflict' }
      }
      reportStorageFailure(saved.reason)
      return { ok: false, reason: saved.reason }
    })
  }

  function commit(mutator: (draft: PlannerDocument) => void, options: CommitOptions = {}): Promise<CommitResult> {
    const { purgeEpoch, expect } = options
    return persist(mutator, (repository, candidate, expected) => {
      // Without the guarded entry (the companion), the server's revision check is all there is.
      if (expect && repository.saveGuarded) {
        return repository.saveGuarded(candidate, expected, { storedFingerprint: expect.storedFingerprint, purgeEpoch: expect.purgeEpoch ?? purgeEpoch })
      }
      return purgeEpoch !== undefined && repository.saveAtEpoch
        ? repository.saveAtEpoch(candidate, expected, purgeEpoch)
        : repository.save(candidate, expected)
    })
  }

  function canDeleteAll(): boolean {
    return requireEnvironment().repository.deleteAll !== undefined
  }

  // Browser delete-all: the mutator builds the fresh document exactly as a commit would.
  function deleteAll(mutator: (draft: PlannerDocument) => void): Promise<CommitResult> {
    return persist(mutator, (repository, candidate, expected) => (
      repository.deleteAll ? repository.deleteAll(candidate, expected) : Promise.resolve({ kind: 'error', reason: 'delete-all-unsupported' })
    ))
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
        reportStorageFailure(saved.kind === 'error' ? saved.reason : 'conflict')
        return { ok: false, reason: error.value ?? 'conflict' }
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
        reportStorageFailure(restored.kind === 'error' ? restored.reason : 'conflict')
        return { ok: false, reason: error.value ?? 'conflict' }
      }
      await applyLoad()
      return { ok: true }
    })
  }

  return {
    document, status, error, stored, migratedFrom, legacyChanged, corruptRaw, corruptReason, backupAvailable, lastChangeLost, writable,
    start, load, commit, deleteAll, canDeleteAll, reportStorageFailure, settled, dismissError, startFresh, restoreBackup,
  }
})
