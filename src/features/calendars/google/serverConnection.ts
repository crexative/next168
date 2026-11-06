// The client of the Weeklid Google server (functions/api/google, design S1b). Every call runs under the cross-tab
// `weeklid-google` lock of design D15: exclusive, acquisition bounded, the task bounded, no steal, no nesting and no
// unlocked fallback. Replies are mapped to closed results; nothing from a reply other than the fields read below is
// kept, and no access token is ever logged or stored.

const BASE = '/api/google'
export const LOCK_NAME = 'weeklid-google'
export const ACQUIRE_DEADLINE_MS = 20_000
export const TASK_DEADLINE_MS = 15_000
const GOOGLE_AUTH_HOST = 'accounts.google.com'
const GENERATION = /^(-|[A-Za-z0-9_-]{22})\.(-|[A-Za-z0-9_-]{22})$/

/** What the server said, or why nothing usable came back. Closed: this is what Details shows. */
export type ServerCode =
  | 'ok' | 'noDevice' | 'notConnected' | 'reconnect' | 'disabled' | 'notConfigured' | 'serverConfig' | 'googleUnavailable'
  | 'storage' | 'forbidden' | 'notFound' | 'badRequest' | 'error'
  | 'network' | 'timeout' | 'malformed' | 'lockUnavailable' | 'busy'

const SERVER_CODES: readonly ServerCode[] = [
  'noDevice', 'notConnected', 'reconnect', 'disabled', 'notConfigured', 'serverConfig', 'googleUnavailable', 'storage',
  'forbidden', 'notFound', 'badRequest', 'error',
]

export type MintResult =
  | { kind: 'token'; accessToken: string; expiresIn: number }
  | { kind: 'signedOut'; code: 'noDevice' | 'notConnected' | 'reconnect' }
  | { kind: 'paused'; code: ServerCode }
  | { kind: 'unavailable'; code: ServerCode }

export type ConnectResult =
  | { kind: 'url'; url: string }
  | { kind: 'paused'; code: ServerCode }
  | { kind: 'unavailable'; code: ServerCode }

/**
 * `confirmed`, `unconfirmed` and `forgotten` are the server's own terminal answers. `cleared`: nothing was deleted
 * and a mint proved this device holds nothing. `mayRemain`: the device cookie is gone, so a credential may still
 * exist under it. `failed`: no terminal answer; the caller must not forget anything locally.
 */
export type ForgetOutcome = 'confirmed' | 'unconfirmed' | 'forgotten' | 'cleared' | 'mayRemain' | 'failed'

// The slices of fetch and navigator.locks used here, declared so the client compiles in the browser and under node tests.
export interface RequestOptions {
  method: 'POST'
  credentials: 'same-origin'
  cache: 'no-store'
  headers: Record<string, string>
  signal: AbortSignal
  body: string | undefined
}

export interface LockPort {
  request<T>(name: string, options: { mode: 'exclusive'; signal: AbortSignal }, task: () => Promise<T>): Promise<T>
}

export interface ServerEnvironment {
  fetch(url: string, options: RequestOptions): Promise<Response>
  locks: LockPort | undefined
  randomBytes(length: number): Uint8Array
}

type Reply = { ok: true; status: number; data: Record<string, unknown> | null } | { ok: false; code: 'network' | 'timeout' }
type Locked<T> = { value: T } | { lock: 'lockUnavailable' | 'busy' }

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function codeOf(reply: Reply & { ok: true }): ServerCode {
  const code = reply.data?.code
  return typeof code === 'string' && (SERVER_CODES as readonly string[]).includes(code) ? (code as ServerCode) : 'malformed'
}

export function createServerConnection(env: ServerEnvironment) {
  let held = 0

  // Runs `task` under the lock without ever running it unlocked. `deadlineMs` bounds both the wait and the task.
  async function locked<T>(task: (signal: AbortSignal, timedOut: () => boolean) => Promise<T>, deadlineMs?: number): Promise<Locked<T>> {
    const locks = env.locks
    if (!locks || typeof locks.request !== 'function') return { lock: 'lockUnavailable' }
    if (held > 0) return { lock: 'busy' }
    held += 1
    try {
      return await locks.request(LOCK_NAME, { mode: 'exclusive', signal: AbortSignal.timeout(deadlineMs ?? ACQUIRE_DEADLINE_MS) }, async () => {
        const controller = new AbortController()
        let expired = false
        const timer = setTimeout(() => { expired = true; controller.abort() }, deadlineMs ?? TASK_DEADLINE_MS)
        try {
          return { value: await task(controller.signal, () => expired) }
        } finally {
          clearTimeout(timer)
        }
      })
    } catch (error) {
      return { lock: error instanceof Error && error.name === 'TimeoutError' ? 'busy' : 'lockUnavailable' }
    } finally {
      held -= 1
    }
  }

  async function post(path: string, signal: AbortSignal, timedOut: () => boolean, body?: unknown): Promise<Reply> {
    const headers: Record<string, string> = { 'X-Weeklid': '1' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    try {
      const response = await env.fetch(`${BASE}/${path}`, {
        method: 'POST', credentials: 'same-origin', cache: 'no-store', headers, signal,
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      let data: unknown = null
      try { data = await response.json() } catch { data = null }
      return { ok: true, status: response.status, data: isRecord(data) ? data : null }
    } catch {
      return { ok: false, code: timedOut() ? 'timeout' : 'network' }
    }
  }

  function mintFrom(reply: Reply): MintResult {
    if (!reply.ok) return { kind: 'unavailable', code: reply.code }
    if (reply.status === 200) {
      const { accessToken, expiresIn } = reply.data ?? {}
      return typeof accessToken === 'string' && accessToken !== '' && typeof expiresIn === 'number' && Number.isFinite(expiresIn)
        ? { kind: 'token', accessToken, expiresIn }
        : { kind: 'unavailable', code: 'malformed' }
    }
    const code = codeOf(reply)
    if (reply.status === 401 && (code === 'noDevice' || code === 'notConnected' || code === 'reconnect')) return { kind: 'signedOut', code }
    if (reply.status === 503 && (code === 'disabled' || code === 'notConfigured')) return { kind: 'paused', code }
    return { kind: 'unavailable', code }
  }

  const lockFailure = (lock: 'lockUnavailable' | 'busy'): { kind: 'unavailable'; code: ServerCode } => ({ kind: 'unavailable', code: lock })

  async function mint(): Promise<MintResult> {
    const run = await locked(async (signal, timedOut) => mintFrom(await post('token', signal, timedOut)))
    return 'lock' in run ? lockFailure(run.lock) : run.value
  }

  async function connect(): Promise<ConnectResult> {
    const epoch = base64url(env.randomBytes(16))
    const run = await locked((signal, timedOut) => post('connect', signal, timedOut, { from: 'app', epoch }))
    if ('lock' in run) return lockFailure(run.lock)
    const reply = run.value
    if (!reply.ok) return { kind: 'unavailable', code: reply.code }
    if (reply.status === 200) {
      const url = reply.data?.url
      return typeof url === 'string' && isGoogleAuthUrl(url) ? { kind: 'url', url } : { kind: 'unavailable', code: 'malformed' }
    }
    const code = codeOf(reply)
    return reply.status === 503 && (code === 'disabled' || code === 'notConfigured') ? { kind: 'paused', code } : { kind: 'unavailable', code }
  }

  async function forgetOnce(revoke: boolean, signal: AbortSignal, timedOut: () => boolean): Promise<'confirmed' | 'unconfirmed' | 'forgotten' | 'none' | 'failed'> {
    const status = await post('status', signal, timedOut)
    if (!status.ok || status.status !== 200 || typeof status.data?.gen !== 'string' || !GENERATION.test(status.data.gen)) return 'failed'
    let gen = status.data.gen
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const reply = await post('disconnect', signal, timedOut, { revoke, gen })
      if (!reply.ok || reply.status !== 200) return 'failed'
      const result = reply.data?.result
      if (result === 'confirmed' || result === 'unconfirmed' || result === 'forgotten' || result === 'none') return result
      const next = reply.data?.gen
      if (result !== 'stale' || typeof next !== 'string' || !GENERATION.test(next)) return 'failed'
      gen = next
    }
    return 'failed'
  }

  // A missing cookie and a cookie with no credential both end in `none`; only a mint tells them apart (design 4-2).
  async function forgetThisDevice(revoke: boolean, options: { deadlineMs?: number } = {}): Promise<ForgetOutcome> {
    const run = await locked(async (signal, timedOut) => {
      const first = await forgetOnce(revoke, signal, timedOut)
      if (first !== 'none') return first
      const probe = mintFrom(await post('token', signal, timedOut))
      if (probe.kind === 'signedOut' && probe.code === 'notConnected') return 'cleared' as const
      if (probe.kind === 'signedOut' && probe.code === 'noDevice') return 'mayRemain' as const
      if (probe.kind !== 'token') return 'failed' as const
      // A connect landed after the first answer: forget once more, and trust only a terminal answer.
      const second = await forgetOnce(revoke, signal, timedOut)
      return second === 'none' ? 'failed' as const : second
    }, options.deadlineMs)
    return 'lock' in run ? 'failed' : run.value
  }

  return { mint, connect, forgetThisDevice }
}

function isGoogleAuthUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === GOOGLE_AUTH_HOST
  } catch {
    return false
  }
}

export type ServerConnection = ReturnType<typeof createServerConnection>

export function browserServerConnection(): ServerConnection {
  return createServerConnection({
    fetch: (url, options) => globalThis.fetch(url, options),
    locks: typeof navigator !== 'undefined' ? (navigator as unknown as { locks?: LockPort }).locks : undefined,
    randomBytes: (length) => crypto.getRandomValues(new Uint8Array(length)),
  })
}
