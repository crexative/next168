import { onBeforeUnmount, ref, type Ref } from 'vue'

export function useMediaQuery(query: string): Ref<boolean> {
  const list = typeof window.matchMedia === 'function' ? window.matchMedia(query) : undefined
  const matches = ref(list?.matches ?? false)
  const update = (event: MediaQueryListEvent) => { matches.value = event.matches }
  list?.addEventListener('change', update)
  onBeforeUnmount(() => list?.removeEventListener('change', update))
  return matches
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
