import { computed, ref } from 'vue'
import { hasUnsavedInput } from '@/ui/unsavedGuard'

export const BROADCAST_CHANNEL = 'next168'

export const updateAvailable = ref(false)
export const reloadBlocked = ref(false)
// The notice can be closed; a later update announcement shows it again.
export const updateDismissed = ref(false)
export const updateNoticeShown = computed(() => updateAvailable.value && !updateDismissed.value)

let channel: BroadcastChannel | undefined
type CanReload = () => Promise<boolean>

let applyUpdate: ((canReload: CanReload) => Promise<void>) | undefined

export function announceUpdate(apply: (canReload: CanReload) => Promise<void>): void {
  applyUpdate = apply
  updateAvailable.value = true
  updateDismissed.value = false
  channel?.postMessage({ type: 'update-available' })
}

export function listenForUpdates(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  channel = new BroadcastChannel(BROADCAST_CHANNEL)
  channel.onmessage = (event: MessageEvent) => {
    if (event.data?.type === 'update-available') { updateAvailable.value = true; updateDismissed.value = false }
  }
  return () => { channel?.close(); channel = undefined }
}

// Skip-waiting makes the new worker claim every tab, and the PWA client reloads each controlled tab
// by default. Wiring `onActivated` as `onNeedReload` keeps that reload out of tabs that did not ask
// for it: they only show the notice and reload later through `reloadWhenReady`, under their own guard.
export function createUpdateApplier(skipWaiting: () => Promise<void>, reload: () => void = () => window.location.reload()) {
  let activated: (() => void) | undefined
  // Another tab may activate the worker before this one asks; remember it so apply() never waits for it.
  let hasActivated = false
  return {
    apply: async (canReload: CanReload = async () => true): Promise<void> => {
      if (!hasActivated) {
        const done = new Promise<void>((resolve) => { activated = resolve })
        await skipWaiting()
        await done
        activated = undefined
      }
      // Input may have been opened while activation was pending; stay activated so a retry can reload.
      if (!(await canReload())) return
      reload()
    },
    onActivated: (): void => {
      hasActivated = true
      updateAvailable.value = true
      updateDismissed.value = false
      activated?.()
    },
  }
}

// Reloads only this tab, after its in-flight commit settled and no open sheet holds unsaved input.
export async function reloadWhenReady(settleCommits: () => Promise<void>): Promise<void> {
  const canReload: CanReload = async () => {
    await settleCommits()
    if (hasUnsavedInput.value) {
      reloadBlocked.value = true
      return false
    }
    reloadBlocked.value = false
    return true
  }
  if (!(await canReload())) return
  if (applyUpdate) await applyUpdate(canReload)
  else window.location.reload()
}
