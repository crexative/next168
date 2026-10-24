import { ref } from 'vue'

// Screens without a tab (assistant, proposals, check-in) have no bar to leave by. The trail remembers which
// screen the person came from so their back control returns there, and falls back to a fixed screen otherwise.
const KNOWN_VIEWS = ['today', 'week', 'tasks', 'insights', 'settings', 'checkin', 'assistant', 'proposals'] as const
export type TrailView = (typeof KNOWN_VIEWS)[number]

export const trail = ref<{ from: string; to: string } | null>(null)

export function viewOfUrl(url: string): string {
  const index = url.indexOf('#')
  const hash = index === -1 ? '' : url.slice(index)
  return hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? ''
}

let installed = false

export function trackNavigation(): void {
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('hashchange', (event) => {
    const from = viewOfUrl(event.oldURL)
    const to = viewOfUrl(event.newURL)
    if (from !== to) trail.value = { from, to }
  })
}

export function backTarget(current: TrailView, fallback: TrailView): TrailView {
  const last = trail.value
  if (last && last.to === current && last.from !== current && (KNOWN_VIEWS as readonly string[]).includes(last.from)) return last.from as TrailView
  return fallback
}
