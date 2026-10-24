import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerUnsavedInput } from '@/ui/unsavedGuard'
import { announceUpdate, reloadBlocked, reloadWhenReady, updateAvailable } from './updates'

beforeEach(() => {
  updateAvailable.value = false
  reloadBlocked.value = false
})

describe('update flow', () => {
  it('marks the update as available without reloading', () => {
    const apply = vi.fn(async () => undefined)
    announceUpdate(apply)
    expect(updateAvailable.value).toBe(true)
    expect(apply).not.toHaveBeenCalled()
  })

  it('waits for the in-flight commit before applying the update', async () => {
    const order: string[] = []
    announceUpdate(async () => { order.push('apply') })
    await reloadWhenReady(async () => { await Promise.resolve(); order.push('settled') })
    expect(order).toEqual(['settled', 'apply'])
  })

  it('is blocked while a sheet holds unsaved input and resumes after it closes', async () => {
    const apply = vi.fn(async () => undefined)
    announceUpdate(apply)
    const release = registerUnsavedInput()
    await reloadWhenReady(async () => undefined)
    expect(apply).not.toHaveBeenCalled()
    expect(reloadBlocked.value).toBe(true)

    release()
    await reloadWhenReady(async () => undefined)
    expect(apply).toHaveBeenCalledOnce()
    expect(reloadBlocked.value).toBe(false)
  })
})
