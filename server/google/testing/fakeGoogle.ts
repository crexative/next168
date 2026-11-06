// A stateful stand-in for Google's token and revoke endpoints. It never contacts Google: codes, refresh tokens and
// access tokens are the synthetic values below, and a test can script, hold or hang any response.
import { CALENDAR_SCOPE } from '../googleOAuth'
import { sha256b64url } from '../crypto'
import { gate, type Gate } from './controlledStore'

export const FAKE = {
  clientId: '123456789012-weeklidfake.apps.googleusercontent.com',
  clientSecret: 'cs-SECRET-789',
  refreshToken: 'rt-SECRET-456',
  accessToken: 'at-SECRET-123',
} as const

export type GoogleCall = 'exchange' | 'refresh' | 'revoke'
/** `hangAfterHeaders`: Google answers 200 headers, then the body never arrives (until the caller's deadline). */
export type Scripted = { status: number; body?: unknown } | 'hang' | 'hangAfterHeaders'

export interface RecordedCall {
  kind: GoogleCall
  url: string
  form: Record<string, string>
}

interface IssuedCode {
  refreshToken: string | null
  scope: string
  challenge: string | null
  used: boolean
}

function untilAborted(signal: AbortSignal | null | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return
    if (signal.aborted) reject(signal.reason)
    signal.addEventListener('abort', () => reject(signal.reason), { once: true })
  })
}

export class FakeGoogle {
  readonly calls: RecordedCall[] = []
  readonly validRefreshTokens = new Set<string>()
  /** The next successful refresh also returns this new refresh token. */
  rotateNextTo: string | null = null
  /** On rotation, the predecessor stops working (redteam2 m2). */
  invalidatePredecessorOnRotate = false
  /** Called when a revoke request arrives, before it is answered: lets a test observe the database at that moment. */
  onRevoke: (() => void) | null = null

  private readonly codes = new Map<string, IssuedCode>()
  private readonly scripted = new Map<GoogleCall, Scripted[]>()
  private readonly holds = new Map<GoogleCall, ReturnType<typeof gate>[]>()
  private issued = 0

  constructor(private readonly origin = 'https://oauth2.googleapis.com', private readonly redirectUri = 'https://weeklid.crexative.com/api/google/callback') {}

  count(kind: GoogleCall): number {
    return this.calls.filter((call) => call.kind === kind).length
  }

  issueCode(options: { refreshToken?: string | null; scope?: string; challenge?: string | null } = {}): string {
    const code = `code-${++this.issued}-4/0AfakeAuthorizationCode`
    this.codes.set(code, {
      refreshToken: options.refreshToken === undefined ? FAKE.refreshToken : options.refreshToken,
      scope: options.scope ?? CALENDAR_SCOPE,
      challenge: options.challenge ?? null,
      used: false,
    })
    return code
  }

  script(kind: GoogleCall, ...responses: Scripted[]): void {
    this.scripted.set(kind, [...(this.scripted.get(kind) ?? []), ...responses])
  }

  hold(kind: GoogleCall): Gate {
    const g = gate()
    this.holds.set(kind, [...(this.holds.get(kind) ?? []), g])
    return g
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')))
    const kind: GoogleCall | null = url === `${this.origin}/revoke` ? 'revoke'
      : url === `${this.origin}/token` ? (form.grant_type === 'refresh_token' ? 'refresh' : 'exchange')
        : null
    if (!kind) throw new TypeError('fetch to an unexpected host')
    this.calls.push({ kind, url, form })
    const signal = init?.signal
    const held = this.holds.get(kind)?.shift()
    if (held) {
      held.arrive()
      await Promise.race([held.released, untilAborted(signal)])
    }
    const scripted = this.scripted.get(kind)?.shift()
    if (scripted === 'hang') return untilAborted(signal)
    if (scripted === 'hangAfterHeaders') {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          untilAborted(signal).catch((reason: unknown) => controller.error(reason))
        },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const reply = scripted ?? await this.answer(kind, form)
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), {
      status: reply.status,
      headers: { 'content-type': 'application/json' },
    })
  }

  private async answer(kind: GoogleCall, form: Record<string, string>): Promise<{ status: number; body?: unknown }> {
    const clientOk = form.client_id === FAKE.clientId && form.client_secret === FAKE.clientSecret
    if (kind === 'revoke') {
      this.onRevoke?.()
      this.validRefreshTokens.delete(form.token ?? '')
      return { status: 200 }
    }
    if (kind === 'exchange') {
      const issued = this.codes.get(form.code ?? '')
      if (!clientOk) return { status: 401, body: { error: 'invalid_client' } }
      if (!issued || issued.used || form.redirect_uri !== this.redirectUri) return { status: 400, body: { error: 'invalid_grant' } }
      if (issued.challenge !== null && (await sha256b64url(form.code_verifier ?? '')) !== issued.challenge) {
        return { status: 400, body: { error: 'invalid_grant' } }
      }
      issued.used = true
      if (issued.refreshToken) this.validRefreshTokens.add(issued.refreshToken)
      return {
        status: 200,
        body: {
          access_token: FAKE.accessToken, expires_in: 3599, token_type: 'Bearer', scope: issued.scope,
          ...(issued.refreshToken ? { refresh_token: issued.refreshToken } : {}),
        },
      }
    }
    if (!clientOk) return { status: 401, body: { error: 'invalid_client' } }
    const token = form.refresh_token ?? ''
    if (!this.validRefreshTokens.has(token)) return { status: 400, body: { error: 'invalid_grant' } }
    const body: Record<string, unknown> = { access_token: FAKE.accessToken, expires_in: 3599, token_type: 'Bearer', scope: CALENDAR_SCOPE }
    if (this.rotateNextTo) {
      body.refresh_token = this.rotateNextTo
      this.validRefreshTokens.add(this.rotateNextTo)
      if (this.invalidatePredecessorOnRotate) this.validRefreshTokens.delete(token)
      this.rotateNextTo = null
    }
    return { status: 200, body }
  }
}
