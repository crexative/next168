import { randomBytes, timingSafeEqual } from 'node:crypto'
import { join } from 'node:path'
import { unlink } from 'node:fs/promises'
import { Mutex, atomicWrite, privateFile, readOptional } from './files'

export function secret(): string { return randomBytes(32).toString('base64url') }
export function equalSecret(a: string, b: string): boolean {
  const left = Buffer.from(a), right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}
export async function mcpToken(home: string) { return privateFile(join(home, 'mcp-token'), secret) }
export async function newPairCode(home: string, now = Date.now()): Promise<string> {
  const code = secret()
  await atomicWrite(join(home, 'pair-code.json'), JSON.stringify({ code, expires: now + 10 * 60_000 }))
  return code
}
export class BrowserSessions {
  private readonly mutex = new Mutex()
  private readonly sessions = new Map<string, number>()
  private attempts = 0
  private resetAt = 0
  constructor(private readonly home: string, private readonly now = Date.now) {}
  async pair(code: unknown): Promise<string | undefined> {
    return this.mutex.run(async () => {
      const now = this.now()
      if (now > this.resetAt) { this.attempts = 0; this.resetAt = now + 60_000 }
      if (++this.attempts > 20 || typeof code !== 'string') return undefined
      const raw = await readOptional(join(this.home, 'pair-code.json'))
      if (!raw) return undefined
      const pair: { code: string; expires: number } = JSON.parse(raw)
      if (now >= pair.expires || !equalSecret(code, pair.code)) return undefined
      await unlink(join(this.home, 'pair-code.json'))
      const session = secret()
      for (const [key, expiry] of this.sessions) if (expiry <= now) this.sessions.delete(key)
      if (this.sessions.size >= 100) this.sessions.delete(this.sessions.keys().next().value!)
      this.sessions.set(session, now + 24 * 60 * 60_000)
      return session
    })
  }
  valid(cookie: string | undefined): boolean {
    const value = cookie?.split(';').map(item => item.trim()).find(item => item.startsWith('next168_session='))?.slice('next168_session='.length)
    if (!value) return false
    return (this.sessions.get(value) ?? 0) > this.now()
  }
}
