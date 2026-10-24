// Tells other tabs that the stored planner changed. Delivery is best effort (BroadcastChannel keeps no log),
// so the repository also re-checks on focus and visibility, and every commit is a compare-and-swap anyway.
export interface ChangeChannel {
  notify(): void
  listen(onChange: () => void): () => void
}

export const CHANGE_CHANNEL_NAME = 'next168-storage'

export function broadcastChangeChannel(name = CHANGE_CHANNEL_NAME): ChangeChannel {
  let channel: BroadcastChannel | undefined
  const open = (): BroadcastChannel | undefined => {
    if (typeof BroadcastChannel === 'undefined') return undefined
    return (channel ??= new BroadcastChannel(name))
  }
  return {
    notify() {
      try {
        open()?.postMessage({ type: 'document-committed' })
      } catch {
        // A lost notification is covered by the focus/visibility re-check and the compare-and-swap.
      }
    },
    listen(onChange) {
      const target = open()
      if (!target) return () => undefined
      const listener = () => onChange()
      target.addEventListener('message', listener)
      return () => target.removeEventListener('message', listener)
    },
  }
}
