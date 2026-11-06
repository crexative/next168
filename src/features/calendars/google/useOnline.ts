import { onScopeDispose, ref } from 'vue'

// Whether the browser says it is online; the Google UI disables what needs the network while it is not.
export function useOnline() {
  const online = ref(typeof navigator === 'undefined' || navigator.onLine !== false)
  const update = () => { online.value = navigator.onLine !== false }
  window.addEventListener('online', update)
  window.addEventListener('offline', update)
  onScopeDispose(() => {
    window.removeEventListener('online', update)
    window.removeEventListener('offline', update)
  })
  return online
}
