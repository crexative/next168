import { onBeforeUnmount, ref } from 'vue'
import type { ViewId } from './contracts'

export const DEFAULT_VIEW: ViewId = 'today'

export function parseHash(hash: string, known: ReadonlySet<string>): ViewId {
  const candidate = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? ''
  return known.has(candidate) ? (candidate as ViewId) : DEFAULT_VIEW
}

export function viewHash(id: ViewId): string {
  return `#/${id}`
}

export function useHashRoute(knownViews: () => ReadonlySet<string>) {
  const current = ref<ViewId>(parseHash(window.location.hash, knownViews()))
  const sync = () => { current.value = parseHash(window.location.hash, knownViews()) }
  window.addEventListener('hashchange', sync)
  onBeforeUnmount(() => window.removeEventListener('hashchange', sync))

  function navigate(id: ViewId): void {
    if (window.location.hash !== viewHash(id)) window.location.hash = viewHash(id)
  }

  return { current, navigate, sync }
}
