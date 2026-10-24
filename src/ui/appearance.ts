import { ref } from 'vue'

// Light or dark is a display preference of this device (like the 12/24 h clock), not part of the planner document.
// index.html applies the stored choice before the first paint with the same key and colours; appearance.spec
// keeps the two in step.
export type Appearance = 'auto' | 'light' | 'dark'
export const APPEARANCES: readonly Appearance[] = ['auto', 'light', 'dark']
export const APPEARANCE_KEY = 'next168-appearance'
// The bar colour of the installed app (and the browser toolbar) for each theme: the grouped background.
export const THEME_COLORS = { light: '#F2F2F7', dark: '#000000' } as const

function isAppearance(value: unknown): value is Appearance {
  return APPEARANCES.includes(value as Appearance)
}

export function storedAppearance(): Appearance {
  try {
    const value = localStorage.getItem(APPEARANCE_KEY)
    return isAppearance(value) ? value : 'auto'
  } catch {
    return 'auto'
  }
}

export const appearance = ref<Appearance>(storedAppearance())

// Sets the theme on <html>: the tokens switch on [data-theme], and so does `color-scheme`. "auto" leaves both to
// prefers-color-scheme. The theme-color metas keep their media queries for "auto" and both name the chosen theme
// otherwise, so the status bar matches the page.
export function applyAppearance(value: Appearance, root: Document = document): void {
  const html = root.documentElement
  if (value === 'auto') delete html.dataset.theme
  else html.dataset.theme = value
  for (const meta of Array.from(root.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))) {
    const scheme = /dark/.test(meta.getAttribute('media') ?? '') ? 'dark' : 'light'
    meta.content = THEME_COLORS[value === 'auto' ? scheme : value]
  }
}

export function setAppearance(value: Appearance): void {
  appearance.value = value
  applyAppearance(value)
  try {
    if (value === 'auto') localStorage.removeItem(APPEARANCE_KEY)
    else localStorage.setItem(APPEARANCE_KEY, value)
  } catch {
    // The choice still applies to this session.
  }
}

// Applies the stored choice and follows changes made in another tab of this app.
let installed = false
export function installAppearance(): void {
  applyAppearance(appearance.value)
  if (installed || typeof window === 'undefined') return
  installed = true
  window.addEventListener('storage', (event) => {
    if (event.key !== APPEARANCE_KEY && event.key !== null) return
    appearance.value = storedAppearance()
    applyAppearance(appearance.value)
  })
}
