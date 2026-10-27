// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { APPEARANCE_KEY, THEME_COLORS, appearance, applyAppearance, installAppearance, setAppearance, storedAppearance } from './appearance'

function metas(): HTMLMetaElement[] {
  return Array.from(document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]'))
}

beforeEach(() => {
  localStorage.clear()
  delete document.documentElement.dataset.theme
  document.head.innerHTML = '<meta name="theme-color" content="#F2F2F7" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#000000" media="(prefers-color-scheme: dark)">'
  appearance.value = 'auto'
})
afterEach(() => vi.restoreAllMocks())

describe('appearance preference', () => {
  it('reads a stored choice and treats anything else as automatic', () => {
    expect(storedAppearance()).toBe('auto')
    localStorage.setItem(APPEARANCE_KEY, 'dark')
    expect(storedAppearance()).toBe('dark')
    localStorage.setItem(APPEARANCE_KEY, 'sepia')
    expect(storedAppearance()).toBe('auto')
  })

  it('sets the theme on <html>, keeps both bar colours on the chosen theme, and stores it on this device', () => {
    setAppearance('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(metas().map((meta) => meta.content)).toEqual([THEME_COLORS.dark, THEME_COLORS.dark])
    expect(localStorage.getItem(APPEARANCE_KEY)).toBe('dark')
    setAppearance('light')
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(metas().map((meta) => meta.content)).toEqual([THEME_COLORS.light, THEME_COLORS.light])
  })

  it('automatic removes the theme and the stored key, and gives each bar colour back to its system theme', () => {
    setAppearance('dark')
    setAppearance('auto')
    expect(document.documentElement.dataset.theme).toBeUndefined()
    expect(localStorage.getItem(APPEARANCE_KEY)).toBeNull()
    expect(metas().map((meta) => meta.content)).toEqual([THEME_COLORS.light, THEME_COLORS.dark])
  })

  it('still applies the choice when storage is unavailable', () => {
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('blocked', 'SecurityError') })
    setAppearance('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(storedAppearance()).toBe('auto')
  })

  it('follows a change made in another tab', () => {
    installAppearance()
    localStorage.setItem(APPEARANCE_KEY, 'dark')
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY, newValue: 'dark' }))
    expect(appearance.value).toBe('dark')
    expect(document.documentElement.dataset.theme).toBe('dark')
    localStorage.removeItem(APPEARANCE_KEY)
    window.dispatchEvent(new StorageEvent('storage', { key: APPEARANCE_KEY, newValue: null }))
    expect(appearance.value).toBe('auto')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })

  it('applies to a given document without touching another', () => {
    const other = document.implementation.createHTMLDocument('other')
    applyAppearance('dark', other)
    expect(other.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})

describe('the pre-paint script (public/prepaint.js)', () => {
  it('uses the same key and bar colours as the preference', () => {
    const script = readFileSync('public/prepaint.js', 'utf8')
    const html = readFileSync('index.html', 'utf8')
    expect(script).toContain(`localStorage.getItem('${APPEARANCE_KEY}')`)
    expect(script).toContain(`'${THEME_COLORS.dark}'`)
    expect(script).toContain(`'${THEME_COLORS.light}'`)
    // It runs before the app's module script.
    expect(html.indexOf('<script src="/prepaint.js">')).toBeLessThan(html.indexOf('<script type="module"'))
  })
})
