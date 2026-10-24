import { open, readFile, rename, unlink, chmod } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'

export async function readOptional(file: string): Promise<string | undefined> {
  try { return await readFile(file, 'utf8') } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
async function writeSynced(file: string, bytes: string) {
  const handle = await open(file, 'wx', 0o600)
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
}
export interface CommitHooks {
  preserveBackup?: boolean
  beforeRename?: () => void | Promise<void>
  syncDirectory?: () => Promise<void>
}
export async function atomicWrite(file: string, bytes: string, hooks: CommitHooks = {}): Promise<{ warning?: 'durability-unknown' }> {
  const temporary = `${file}.${randomUUID()}.tmp`
  const backupTemporary = `${temporary}.bak`
  try {
    const previous = await readOptional(file)
    if (previous !== undefined && !hooks.preserveBackup) {
      await writeSynced(backupTemporary, previous)
      await rename(backupTemporary, `${file}.bak`)
    }
    await writeSynced(temporary, bytes)
    await hooks.beforeRename?.()
    await rename(temporary, file)
    try {
      if (hooks.syncDirectory) await hooks.syncDirectory()
      else {
        const directory = await open(dirname(file), 'r')
        try { await directory.sync() } finally { await directory.close() }
      }
    } catch { return { warning: 'durability-unknown' } }
    return {}
  } finally {
    await unlink(temporary).catch(() => undefined)
    await unlink(backupTemporary).catch(() => undefined)
  }
}
export async function privateFile(file: string, create: () => string): Promise<string> {
  const existing = await readOptional(file)
  if (existing !== undefined) { await chmod(file, 0o600); return existing.trim() }
  try { await writeSynced(file, create()) } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
  }
  return (await readFile(file, 'utf8')).trim()
}
export class Mutex {
  private queue: Promise<unknown> = Promise.resolve()
  run<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation)
    this.queue = next.catch(() => undefined)
    return next
  }
}
