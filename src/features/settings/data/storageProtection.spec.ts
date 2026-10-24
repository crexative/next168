// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import PersistOnFirstCheckIn from '@/features/onboarding/PersistOnFirstCheckIn.vue'
import StorageProtection from './StorageProtection.vue'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import { PERSIST_REQUESTED_KEY, shouldRequestPersistence } from './storageProtection'

let mounted: Mounted | undefined
const persist = vi.fn().mockResolvedValue(true)
beforeEach(() => { persist.mockClear(); localStorage.clear(); Object.defineProperty(navigator, 'storage', { value: { persist }, configurable: true }) })
afterEach(() => { mounted?.unmount(); document.body.innerHTML = '' })

it('asks only once there is a first check-in', () => {
  expect(shouldRequestPersistence({ checkIns: 0, requested: false })).toBe(false)
  expect(shouldRequestPersistence({ checkIns: 1, requested: false })).toBe(true)
  expect(shouldRequestPersistence({ checkIns: 1, requested: true })).toBe(false)
})

it('shows storage status without a second owner that can request before a check-in or retry a refusal', async () => {
  Object.defineProperty(navigator, 'storage', { value: { persist, persisted: async () => false }, configurable: true })
  mounted = await mountWithPlanner(StorageProtection, {})
  await nextTick()
  expect(mounted.host.querySelector('[data-testid=persistence-status]')?.textContent).toBe('Not yet')
  expect(mounted.host.querySelector('button')).toBeNull()
  expect(persist).not.toHaveBeenCalled()
})

it('does not ask before the first check-in, asks when it is saved, and only that once', async () => {
  mounted = await mountWithPlanner(PersistOnFirstCheckIn, {})
  expect(persist).not.toHaveBeenCalled()
  await mounted.store.commit((draft) => { draft.checkIns.push({ date: '2026-10-24', note: 'ok' }) })
  await nextTick()
  expect(persist).toHaveBeenCalledTimes(1)
  expect(localStorage.getItem(PERSIST_REQUESTED_KEY)).not.toBeNull()
  await mounted.store.commit((draft) => { draft.checkIns.push({ date: '2026-10-25', note: 'again' }) })
  await nextTick()
  expect(persist).toHaveBeenCalledTimes(1)
})
