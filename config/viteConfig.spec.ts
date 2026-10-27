// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest'
import type { ConfigEnv, UserConfigFnObject } from 'vite'

const SECRET = 'build-token-5f2e' // secret-guard: allow — synthetic test vector, never a real credential
const ENV: ConfigEnv = { command: 'build', mode: 'production', isPreview: false, isSsrBuild: false }

afterEach(() => { delete process.env.VITE_PUBLIC_URL; delete process.env.VITE_GOOGLE_CLIENT_ID })

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

// Google Calendar ships only with a well-formed OAuth web client ID (Slice 1 spec §3, acceptance A2).
describe('vite.config Google client ID', () => {
  it.each([
    'not-an-id',
    '908564359172-abc.apps.googleusercontent.com.evil.example',
    'abc-def.apps.googleusercontent.com',
    '000000000000-E2E.apps.googleusercontent.com',
    '000000000000-e2etest.apps.googleusercontent.com ',
  ])('fails the build on the malformed ID %j', async (id) => {
    process.env.VITE_GOOGLE_CLIENT_ID = id
    const config = (await import('../vite.config')).default as UserConfigFnObject
    expect(() => config(ENV)).toThrow(/^VITE_GOOGLE_CLIENT_ID is not a Google OAuth web client ID/)
  })

  it('builds with a well-formed ID, and without one', async () => {
    const config = (await import('../vite.config')).default as UserConfigFnObject
    process.env.VITE_GOOGLE_CLIENT_ID = '000000000000-e2etest.apps.googleusercontent.com'
    expect(() => config(ENV)).not.toThrow()
    delete process.env.VITE_GOOGLE_CLIENT_ID
    expect(() => config(ENV)).not.toThrow()
  })

  it('makes the service worker leave every Google request to the network', async () => {
    const { RUNTIME_CACHING } = await import('../vite.config')
    const handlerFor = (href: string) => RUNTIME_CACHING.find((rule) => rule.urlPattern({ url: new URL(href) }))?.handler
    expect(handlerFor('https://www.googleapis.com/calendar/v3/calendars/primary/events')).toBe('NetworkOnly')
    expect(handlerFor('https://accounts.google.com/gsi/client')).toBe('NetworkOnly')
    expect(handlerFor('https://example.com/feed.ics')).toBeUndefined()
  })
})
