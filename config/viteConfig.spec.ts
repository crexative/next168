// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import type { ConfigEnv, UserConfigFnObject } from 'vite'

const SECRET = 'build-token-5f2e' // secret-guard: allow — synthetic test vector, never a real credential
const ENV: ConfigEnv = { command: 'build', mode: 'production', isPreview: false, isSsrBuild: false }

afterEach(() => { delete process.env.VITE_PUBLIC_URL })

// The real build entry: an unsafe VITE_PUBLIC_URL fails the build without echoing the value into the logs.
describe('vite.config public address', () => {
  it('fails the build on a credential-bearing address and keeps the credential out of the error', async () => {
    process.env.VITE_PUBLIC_URL = `https://ci:${SECRET}@next168.app/?key=${SECRET}`
    const config = (await import('../vite.config')).default as UserConfigFnObject
    expect(() => config(ENV)).toThrow(/^VITE_PUBLIC_URL is not a public address: /)
    try {
      config(ENV)
    } catch (failure) {
      expect((failure as Error).message).not.toContain(SECRET)
      expect((failure as Error).message).not.toContain('next168.app')
    }
  })

  it('builds with a public address, and without one', async () => {
    const config = (await import('../vite.config')).default as UserConfigFnObject
    process.env.VITE_PUBLIC_URL = 'https://next168.app/'
    expect(() => config(ENV)).not.toThrow()
    delete process.env.VITE_PUBLIC_URL
    expect(() => config(ENV)).not.toThrow()
  })
})
