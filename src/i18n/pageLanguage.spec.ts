import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SUPPORTED_LOCALES, detectLocale, setLocale } from './index'

// verify4 defect 5: the served page said lang="en", so Chrome offered to translate a Spanish UI.
// The script is an external file (public/prepaint.js) because the page's Content Security Policy allows no inline script.
const inline = readFileSync(join(__dirname, '..', '..', 'public', 'prepaint.js'), 'utf8')

function languageBeforePaint(saved: string | null, browser: string): string {
  const root = { lang: 'unset' }
  const storage = { getItem: (key: string) => (key === 'next168-language' ? saved : null) }
  new Function('document', 'navigator', 'localStorage', inline)({ documentElement: root }, { language: browser }, storage)
  return root.lang
}

afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('the language the page declares', () => {
  it('is set before the first paint, with the same supported list and detection as the app', () => {
    expect(inline).toContain(`[${SUPPORTED_LOCALES.map((code) => `'${code}'`).join(', ')}]`)
    for (const [saved, browser] of [[null, 'es-CO'], ['de', 'es-CO'], [null, 'ja-JP'], ['xx', 'pt-BR'], [null, 'fr'], ['en', 'de-DE']] as const) {
      vi.spyOn(navigator, 'language', 'get').mockReturnValue(browser)
      if (saved === null) localStorage.removeItem('next168-language')
      else localStorage.setItem('next168-language', saved)
      expect(languageBeforePaint(saved, browser), `${saved}/${browser}`).toBe(detectLocale())
    }
  })

  it('still follows the browser when storage cannot be read', () => {
    const root = { lang: 'unset' }
    const storage = { getItem: () => { throw new Error('blocked') } }
    new Function('document', 'navigator', 'localStorage', inline)({ documentElement: root }, { language: 'es-MX' }, storage)
    expect(root.lang).toBe('es')
  })

  it('is stated by the app at start and kept in sync when the language changes', () => {
    expect(document.documentElement.lang).toBe(detectLocale())
    setLocale('pt')
    expect(document.documentElement.lang).toBe('pt')
    setLocale('en')
  })
})
