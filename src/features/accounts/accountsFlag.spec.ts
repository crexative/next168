import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

async function flagWith(value: string | undefined): Promise<boolean> {
  if (value === undefined) vi.stubEnv('VITE_ACCOUNTS', undefined as unknown as string)
  else vi.stubEnv('VITE_ACCOUNTS', value)
  vi.resetModules()
  return (await import('./accountsFlag')).ACCOUNTS_ENABLED
}

describe('ACCOUNTS_ENABLED', () => {
  it('is on only for VITE_ACCOUNTS=1', async () => {
    expect(await flagWith('1')).toBe(true)
  })

  it.each([undefined, '', '0', 'true', '2', ' 1'])('is off for %j', async (value) => {
    expect(await flagWith(value)).toBe(false)
  })
})
