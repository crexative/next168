import { computed, ref } from 'vue'

// Sheets with unsaved input register here; the update flow refuses to reload while any is open.
const openDirtySheets = ref(0)

export const hasUnsavedInput = computed(() => openDirtySheets.value > 0)

export function registerUnsavedInput(): () => void {
  openDirtySheets.value += 1
  let released = false
  return () => {
    if (released) return
    released = true
    openDirtySheets.value -= 1
  }
}
