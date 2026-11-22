// Text a person typed or pasted into a sheet (an AI's reply, a calendar URL, a question) and has not saved: a field
// counts once it holds something other than what it held when it took focus, and only while it is still on screen.
export type TextField = HTMLInputElement | HTMLTextAreaElement

const TEXT_INPUT_TYPES: ReadonlySet<string> = new Set(['text', 'url', 'search', 'email', 'tel', 'password', 'number'])

export function isTextField(target: EventTarget | null): target is TextField {
  if (target instanceof HTMLTextAreaElement) return !target.readOnly && !target.disabled
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type) && !target.readOnly && !target.disabled
}

// A field that saves itself when it changes (a calendar's name) holds nothing unsaved once it has changed.
const savesOnChange = (field: TextField) => field.hasAttribute('data-saves-on-change')

export interface TypedText {
  // Starts following the fields inside the root (a sheet) as they take focus.
  watch(root: () => Element | null): () => void
  changedField(): TextField | undefined
  reset(): void
}

export function trackTypedText(): TypedText {
  let initial = new WeakMap<TextField, string>()
  let touched = new Set<TextField>()
  const changed = (field: TextField) => field.isConnected && field.value.trim() !== (initial.get(field) ?? '').trim()
  return {
    watch(root) {
      const onFocusIn = (event: FocusEvent) => {
        const field = event.target
        if (!isTextField(field) || savesOnChange(field) || !root()?.contains(field) || initial.has(field)) return
        initial.set(field, field.value)
        touched.add(field)
      }
      document.addEventListener('focusin', onFocusIn)
      return () => document.removeEventListener('focusin', onFocusIn)
    },
    changedField: () => [...touched].find(changed),
    reset() {
      initial = new WeakMap()
      touched = new Set()
    },
  }
}
