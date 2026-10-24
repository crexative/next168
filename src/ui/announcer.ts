import { readonly, ref } from 'vue'

// One polite live region for the whole app (LiveAnnouncer in the shell). Bursts of announcements (a route
// change, typing, a stream of updates) are debounced so only the latest one is read, once.
export const ANNOUNCE_DEBOUNCE_MS = 300

const current = ref('')
let timer: ReturnType<typeof setTimeout> | undefined

export function announce(message: string, debounceMs: number = ANNOUNCE_DEBOUNCE_MS): void {
  clearTimeout(timer)
  timer = setTimeout(() => {
    // Clearing first makes a repeated identical message a new change that screen readers read again.
    current.value = ''
    timer = setTimeout(() => { current.value = message }, 50)
  }, debounceMs)
}

export function cancelAnnouncements(): void {
  clearTimeout(timer)
  current.value = ''
}

export const announcement = readonly(current)
