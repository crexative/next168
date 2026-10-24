import { onBeforeUnmount, ref } from 'vue'

// `#/settings` is the list; each sub-page sits one level below it. The shell only reads the first segment.
export const SETTINGS_PAGES = ['calendars', 'data', 'advanced'] as const
export type SettingsSubpage = (typeof SETTINGS_PAGES)[number]
export type SettingsPage = 'home' | SettingsSubpage

export const SETTINGS_HASH = '#/settings'
export const CALENDARS_HASH = '#/settings/calendars'
export const DATA_HASH = '#/settings/data'
export const ADVANCED_HASH = '#/settings/advanced'

export function settingsPageOf(hash: string): SettingsPage {
  const [view, page] = hash.replace(/^#\/?/, '').split(/[/?]/)
  return view === 'settings' && (SETTINGS_PAGES as readonly string[]).includes(page ?? '') ? page as SettingsSubpage : 'home'
}

export function useSettingsPage() {
  const page = ref<SettingsPage>(settingsPageOf(window.location.hash))
  const sync = () => { page.value = settingsPageOf(window.location.hash) }
  window.addEventListener('hashchange', sync)
  onBeforeUnmount(() => window.removeEventListener('hashchange', sync))
  return page
}
