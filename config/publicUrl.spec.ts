import { describe, expect, it } from 'vitest'
import { displayPublicUrl, validatePublicUrl } from './publicUrl'

describe('validatePublicUrl', () => {
  it.each([
    'http://next168.app/', 'https://192.168.1.20', 'https://[::1]', 'https://localhost', 'https://app.localhost',
    'https://x.local', 'https://u:p@next168.app', 'https://next168.app/?t=1', 'https://next168.app/#x', 'https://intranet',
    'https://router.internal/', 'https://10.0.0.1:8443/', 'next168.app', '', 'https://next168.app/?', 'https://next168.app/#',
  ])('rejects %s', (raw) => {
    expect(validatePublicUrl(raw).ok).toBe(false)
  })

  it('accepts a public HTTPS address and keeps a path', () => {
    expect(validatePublicUrl('https://next168.app/')).toEqual({ ok: true, url: 'https://next168.app/' })
    expect(validatePublicUrl('https://crexative.github.io/next168/')).toEqual({ ok: true, url: 'https://crexative.github.io/next168/' })
  })

  it('reads as a bare address on the image', () => {
    expect(displayPublicUrl('https://next168.app/')).toBe('next168.app')
    expect(displayPublicUrl('https://crexative.github.io/next168/')).toBe('crexative.github.io/next168')
  })
})
