import { readonly, ref } from 'vue'

const SAVED_VISIBLE_MS = 4000

// Set by the form on save and read by Today's card after the route changes: the form is gone by then.
const saved = ref(false)
let timer: ReturnType<typeof setTimeout> | undefined

export function markCheckInSaved(): void {
  clearTimeout(timer)
  saved.value = true
  timer = setTimeout(() => { saved.value = false }, SAVED_VISIBLE_MS)
}

export function consumeSavedFlag(): boolean {
  return saved.value
}

export const justSaved = readonly(saved)
