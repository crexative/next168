import { describe, expect, it, vi } from 'vitest'
import { GOOGLE_LABS_KEY, captureLabsFlag, googleConnectionEnabled, readLabsFlag, type GoogleGateInput } from './googleGate'

// The gate (Slice 1 spec §3, acceptance A2): the feature exists only with a client ID, outside companion mode, with the
// device's labs flag and in a secure context.
const all: GoogleGateInput = { clientId: '000000000000-e2etest.apps.googleusercontent.com', mode: 'browser', labs: true, secure: true }

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value) }, values }
}

describe('googleConnectionEnabled', () => {
  it('is true only when all four conditions hold', () => {
    expect(googleConnectionEnabled(all)).toBe(true)
  })

  it.each([
    ['without a client ID', { clientId: undefined }],
    ['with an empty client ID', { clientId: '' }],
    ['in companion mode', { mode: 'companion' as const }],
    ['without the labs flag', { labs: false }],
    ['outside a secure context', { secure: false }],
  ])('is false %s', (_, change) => {
    expect(googleConnectionEnabled({ ...all, ...change })).toBe(false)
  })
})

describe('the labs flag', () => {
  it('is set by ?labs=google-calendar, which then leaves the address', () => {
    const storage = memoryStorage()
    const replaceState = vi.fn()
    captureLabsFlag({ href: 'https://weeklid.crexative.com/?labs=google-calendar#/week' }, { replaceState }, storage)
    expect(storage.values.get(GOOGLE_LABS_KEY)).toBe('1')
    expect(readLabsFlag(storage)).toBe(true)
    expect(replaceState).toHaveBeenCalledWith(null, '', 'https://weeklid.crexative.com/#/week')
  })

  it('ignores any other labs value and a page without the parameter', () => {
    const storage = memoryStorage()
    const replaceState = vi.fn()
    captureLabsFlag({ href: 'https://weeklid.crexative.com/?labs=other' }, { replaceState }, storage)
    captureLabsFlag({ href: 'https://weeklid.crexative.com/#/week' }, { replaceState }, storage)
    expect(readLabsFlag(storage)).toBe(false)
    expect(replaceState).not.toHaveBeenCalled()
  })

  it('is a next168- key, so Delete all data removes it with the rest', () => {
    expect(GOOGLE_LABS_KEY.startsWith('next168-')).toBe(true)
  })
})
