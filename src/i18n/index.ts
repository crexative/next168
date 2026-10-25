import { createI18n } from 'vue-i18n'

export const SUPPORTED_LOCALES = ['en', 'es', 'fr', 'pt', 'de'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

export const LANGUAGE_KEY = 'next168-language'

const namespaceFiles = import.meta.glob<{ default: Record<string, unknown> }>('./*/*.json', { eager: true })

// Each file src/i18n/<locale>/<namespace>.json becomes messages[locale][namespace].
export function collectMessages(files: Record<string, { default: Record<string, unknown> }>): Record<string, Record<string, unknown>> {
  const messages: Record<string, Record<string, unknown>> = {}
  for (const [path, module] of Object.entries(files)) {
    const match = /\.\/([^/]+)\/([^/]+)\.json$/.exec(path)
    if (!match) continue
    const [, locale, namespace] = match
    ;(messages[locale!] ??= {})[namespace!] = module.default
  }
  return messages
}

export function isSupportedLocale(value: string | null | undefined): value is SupportedLocale {
  return SUPPORTED_LOCALES.includes(value as SupportedLocale)
}

export function detectLocale(): SupportedLocale {
  let saved: string | null = null
  try {
    saved = localStorage.getItem(LANGUAGE_KEY)
  } catch {
    saved = null
  }
  const browser = navigator.language.split('-')[0]
  return isSupportedLocale(saved) ? saved : isSupportedLocale(browser) ? browser : 'en'
}

export const i18n = createI18n<false>({
  legacy: false,
  locale: detectLocale(),
  fallbackLocale: 'en',
  messages: collectMessages(namespaceFiles) as never,
})

export const availableLocales: { code: SupportedLocale; name: string }[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'pt', name: 'Português' },
  { code: 'de', name: 'Deutsch' },
]

export function setLocale(locale: SupportedLocale): void {
  i18n.global.locale.value = locale as typeof i18n.global.locale.value
  document.documentElement.lang = locale
  try {
    localStorage.setItem(LANGUAGE_KEY, locale)
  } catch {
    // Preference is optional; the document setting is the source of truth.
  }
}
