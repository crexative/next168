import { describe, expect, it } from 'vitest'
import { assertPublicUrl, displayPublicUrl, validatePublicUrl } from './publicUrl'

describe('validatePublicUrl', () => {
  it.each([
    'http://next168.app/', 'https://192.168.1.20', 'https://[::1]', 'https://localhost', 'https://app.localhost',
    'https://x.local', 'https://u:p@next168.app', 'https://next168.app/?t=1', 'https://next168.app/#x', 'https://intranet',
    'https://router.internal/', 'https://10.0.0.1:8443/', 'next168.app', '', 'https://next168.app/?', 'https://next168.app/#',
    // A terminal DNS dot names the same host: absolute local names, private suffixes and IP literals stay refused.
    'https://localhost./', 'https://LOCALHOST./', 'https://app.localhost./', 'https://router.local./', 'https://nas.internal./',
    'https://my-pc.lan./', 'https://my-pc.lan/', 'https://printer.home.arpa./', 'https://box.localdomain/', 'https://localhost../',
    'https://intranet./', 'https://192.168.1.20./', 'https://3232235796/', 'https://0x7f.1/', 'https://[::1]/',
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

describe('assertPublicUrl', () => {
  it('names the variable and the reason, never the value, so a rejected secret stays out of build logs', () => {
    for (const raw of ['https://deploy-user:s3cret-pass@next168.app/', 'https://next168.app/?token=tok-abc123', 'http://10.0.0.7/#session-xyz']) {
      let message = ''
      try {
        assertPublicUrl(raw)
      } catch (failure) {
        message = (failure as Error).message
      }
      expect(message).toMatch(/^VITE_PUBLIC_URL is not a public address: /)
      for (const secret of ['deploy-user', 's3cret-pass', 'tok-abc123', 'session-xyz', '10.0.0.7', raw]) expect(message).not.toContain(secret)
    }
  })

  it('returns the validated address', () => {
    expect(assertPublicUrl('https://next168.app/')).toBe('https://next168.app/')
  })
})
