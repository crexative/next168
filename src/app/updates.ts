import { ref } from 'vue'
import { hasUnsavedInput } from '@/ui/unsavedGuard'

export const BROADCAST_CHANNEL = 'next168'

export const updateAvailable = ref(false)
export const reloadBlocked = ref(false)

let channel: BroadcastChannel | undefined
let applyUpdate: (() => Promise<void>) | undefined

export function announceUpdate(apply: () => Promise<void>): void {
  applyUpdate = apply
  updateAvailable.value = true
  channel?.postMessage({ type: 'update-available' })
}

export function listenForUpdates(): () => void {
  if (typeof BroadcastChannel === 'undefined') return () => undefined
  channel = new BroadcastChannel(BROADCAST_CHANNEL)
  channel.onmessage = (event: MessageEvent) => {
    if (event.data?.type === 'update-available') updateAvailable.value = true
  }
  return () => { channel?.close(); channel = undefined }
}

// Reloads only this tab, after its in-flight commit settled and no open sheet holds unsaved input.
export async function reloadWhenReady(settleCommits: () => Promise<void>): Promise<void> {
  await settleCommits()
  if (hasUnsavedInput.value) {
    reloadBlocked.value = true
    return
  }
  reloadBlocked.value = false
  if (applyUpdate) await applyUpdate()
  else window.location.reload()
}
