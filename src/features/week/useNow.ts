import { onBeforeUnmount, onMounted, ref, type Ref } from 'vue'

export const NOW_REFRESH_MS = 30_000

export function useNow(intervalMs = NOW_REFRESH_MS): Ref<Date> {
  const now = ref(new Date())
  const refresh = () => { now.value = new Date() }
  let timer: ReturnType<typeof setInterval> | undefined
  onMounted(() => {
    timer = setInterval(refresh, intervalMs)
    document.addEventListener('visibilitychange', refresh)
  })
  onBeforeUnmount(() => {
    clearInterval(timer)
    document.removeEventListener('visibilitychange', refresh)
  })
  return now
}
