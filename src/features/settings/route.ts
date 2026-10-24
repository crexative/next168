import { onBeforeUnmount, ref } from 'vue'

export type SettingsPage = 'home' | 'advanced'

export const ADVANCED_HASH = '#/settings/advanced'
export const SETTINGS_HASH = '#/settings'

// `#/settings` is the list; `#/settings/advanced` is the one page below it. The shell only reads the first segment.
export function settingsPageOf(hash: string): SettingsPage {
  const [view, page] = hash.replace(/^#\/?/, '').split(/[/?]/)
  return view === 'settings' && page === 'advanced' ? 'advanced' : 'home'
}

export function useSettingsPage() {
  const page = ref<SettingsPage>(settingsPageOf(window.location.hash))
  const sync = () => { page.value = settingsPageOf(window.location.hash) }
  window.addEventListener('hashchange', sync)
  onBeforeUnmount(() => window.removeEventListener('hashchange', sync))
  return page
}
