import { describe, expect, it } from 'vitest'
import { removeDeviceData } from './deviceData'

class FakeStorage {
  readonly data = new Map<string, string>()
  get length(): number { return this.data.size }
  key(index: number): string | null { return [...this.data.keys()][index] ?? null }
  removeItem(key: string): void { this.data.delete(key) }
}

// verify4 defect 8: delete-all left next168-plan-since:<deleted workspace id> (and every key not on a fixed list).
describe('delete-all on this device', () => {
  it('removes every key of the app, including the ones named after the deleted workspace, and keeps the language', () => {
    const storage = new FakeStorage()
    for (const key of [
      'next168-plan-since:ws-deleted', 'next168-setup-dismissed', 'next168-checkin-reminder', 'next168-checkin-reminder-last',
      'next168-hour-cycle', 'next168-assistant-provider', 'next168-appearance', 'next168-last-export', 'next168-v2',
      'next168-language', 'other-app',
    ]) storage.data.set(key, 'x')
    expect(removeDeviceData(storage)).toHaveLength(9)
    expect([...storage.data.keys()].sort()).toEqual(['next168-language', 'other-app'])
  })

  it('clears the setup draft of the tab as well', () => {
    const session = new FakeStorage()
    session.data.set('next168-setup-draft', '{}')
    session.data.set('next168-setup-tab', 'nonce')
    removeDeviceData(session)
    expect(session.data.size).toBe(0)
  })
})
