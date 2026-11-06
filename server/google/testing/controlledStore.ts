// Wraps the store port with fault injection (`failNext`) and holds (`hold`), so a test can make one operation fail
// or park it before it touches the database while other requests run.
import type { ConnectionStore } from '../connectionStore'

export type StoreOp = keyof ConnectionStore

export interface Gate {
  /** Resolves once the held operation has arrived and is waiting. */
  reached: Promise<void>
  release(): void
}

export function gate(): Gate & { arrive(): void; released: Promise<void> } {
  let arrive!: () => void
  let release!: () => void
  const reached = new Promise<void>((resolve) => { arrive = resolve })
  const released = new Promise<void>((resolve) => { release = resolve })
  return { reached, released, arrive, release }
}

export class ControlledStore implements ConnectionStore {
  readonly calls: StoreOp[] = []
  private readonly failures = new Set<StoreOp>()
  private readonly holds = new Map<StoreOp, ReturnType<typeof gate>[]>()

  constructor(private readonly inner: ConnectionStore) {}

  failNext(op: StoreOp): void {
    this.failures.add(op)
  }

  hold(op: StoreOp): Gate {
    const g = gate()
    this.holds.set(op, [...(this.holds.get(op) ?? []), g])
    return g
  }

  private async run<T>(op: StoreOp, work: () => Promise<T>): Promise<T> {
    this.calls.push(op)
    const held = this.holds.get(op)?.shift()
    if (held) {
      held.arrive()
      await held.released
    }
    if (this.failures.delete(op)) throw new Error('injected D1 failure')
    return work()
  }

  upsertPending: ConnectionStore['upsertPending'] = (...a) => this.run('upsertPending', () => this.inner.upsertPending(...a))
  findPending: ConnectionStore['findPending'] = (...a) => this.run('findPending', () => this.inner.findPending(...a))
  commit: ConnectionStore['commit'] = (c) => this.run('commit', () => this.inner.commit(c))
  deletePending: ConnectionStore['deletePending'] = (...a) => this.run('deletePending', () => this.inner.deletePending(...a))
  mintRead: ConnectionStore['mintRead'] = (...a) => this.run('mintRead', () => this.inner.mintRead(...a))
  touch: ConnectionStore['touch'] = (...a) => this.run('touch', () => this.inner.touch(...a))
  rotate: ConnectionStore['rotate'] = (...a) => this.run('rotate', () => this.inner.rotate(...a))
  deleteCredential: ConnectionStore['deleteCredential'] = (...a) => this.run('deleteCredential', () => this.inner.deleteCredential(...a))
  sweep: ConnectionStore['sweep'] = (s) => this.run('sweep', () => this.inner.sweep(s))
  status: ConnectionStore['status'] = (...a) => this.run('status', () => this.inner.status(...a))
  disconnect: ConnectionStore['disconnect'] = (...a) => this.run('disconnect', () => this.inner.disconnect(...a))
}
