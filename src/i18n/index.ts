import { createI18n } from 'vue-i18n'
import en from './locales/en'
import { agendaEnglish, agendaSpanish } from './agenda'
import es from './locales/es'
import fr from './locales/fr'
import pt from './locales/pt'
import de from './locales/de'

// Get saved language from localStorage or use browser language
const savedLanguage = localStorage.getItem('next168-language')
const browserLanguage = navigator.language.split('-')[0] ?? 'en'
const supportedLanguages = ['en', 'es', 'fr', 'pt', 'de'] as const
const defaultLanguage: typeof supportedLanguages[number] = savedLanguage && supportedLanguages.includes(savedLanguage as typeof supportedLanguages[number])
  ? savedLanguage as typeof supportedLanguages[number]
  : supportedLanguages.includes(browserLanguage as typeof supportedLanguages[number])
    ? browserLanguage as typeof supportedLanguages[number]
    : 'en'

export const i18n = createI18n({
  legacy: false, // Use Composition API mode
  locale: defaultLanguage,
  fallbackLocale: 'en',
  messages: {
    en: { ...en, agenda: agendaEnglish },
    es: { ...es, agenda: agendaSpanish },
    fr,
    pt,
    de
  }
})

export const availableLocales = [
  { code: 'en', name: 'English', flag: '🇺🇸' },
  { code: 'es', name: 'Español', flag: '🇪🇸' },
  { code: 'fr', name: 'Français', flag: '🇫🇷' },
  { code: 'pt', name: 'Português', flag: '🇧🇷' },
  { code: 'de', name: 'Deutsch', flag: '🇩🇪' }
]

// Save language to localStorage when changed
export function setLocale(locale: string) {
  i18n.global.locale.value = locale as 'en' | 'es' | 'fr' | 'pt' | 'de'
  localStorage.setItem('next168-language', locale)
}
