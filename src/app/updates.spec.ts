import { beforeEach, describe, expect, it, vi } from 'vitest'
import { registerUnsavedInput } from '@/ui/unsavedGuard'
import { announceUpdate, createUpdateApplier, reloadBlocked, reloadWhenReady, updateAvailable } from './updates'

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

  it('does not reload a tab that never asked for the update when the worker activates', () => {
    const reload = vi.fn()
    const applier = createUpdateApplier(async () => undefined, reload)
    applier.onActivated()
    expect(reload).not.toHaveBeenCalled()
    expect(updateAvailable.value).toBe(true)
  })

  it('reloads the requesting tab only once the new worker is active', async () => {
    const reload = vi.fn()
    const skipWaiting = vi.fn(async () => undefined)
    const applier = createUpdateApplier(skipWaiting, reload)
    const pending = applier.apply()
    await Promise.resolve()
    await Promise.resolve()
    expect(skipWaiting).toHaveBeenCalledOnce()
    expect(reload).not.toHaveBeenCalled()
    applier.onActivated()
    await pending
    expect(reload).toHaveBeenCalledOnce()
  })

  it('reloads immediately when the worker activated before the update was requested', async () => {
    const reload = vi.fn()
    const skipWaiting = vi.fn(async () => undefined)
    const applier = createUpdateApplier(skipWaiting, reload)
    applier.onActivated()
    await applier.apply()
    expect(reload).toHaveBeenCalledOnce()
  })

  it('does not reload over input opened while activation is pending, and retries safely', async () => {
    const reload = vi.fn()
    const applier = createUpdateApplier(async () => undefined, reload)
    announceUpdate(applier.apply)
    const pending = reloadWhenReady(async () => undefined)
    await Promise.resolve()
    await Promise.resolve()
    const release = registerUnsavedInput()
    applier.onActivated()
    await pending
    expect(reload).not.toHaveBeenCalled()
    expect(reloadBlocked.value).toBe(true)

    release()
    await reloadWhenReady(async () => undefined)
    expect(reload).toHaveBeenCalledOnce()
    expect(reloadBlocked.value).toBe(false)
  })
})
