// A stand-in for Google's token endpoint for sign-in. It never contacts Google: codes, subjects and e-mails are synthetic.
import { base64url, sha256b64url } from '../../google/crypto'

export const FAKE_ID = {
  clientId: '123456789012-weeklidfake.apps.googleusercontent.com',
  clientSecret: 'cs-SECRET-789',
} as const

export interface IssuedIdentity {
  sub: string
  email: string
  emailVerified?: boolean
  /** Raw claim overrides, applied last: use it to break iss, aud, exp or nonce. */
  claims?: Record<string, unknown>
}

interface IssuedCode extends IssuedIdentity {
  challenge: string | null
  nonce: string | null
  used: boolean
}

export interface RecordedCall {
  url: string
  form: Record<string, string>
}

const encoder = new TextEncoder()

export class FakeIdentity {
  readonly calls: RecordedCall[] = []
  private readonly codes = new Map<string, IssuedCode>()
  private issued = 0
  private scripted: { status: number; body?: unknown } | 'hang' | null = null

  constructor(private readonly origin = 'https://oauth2.googleapis.com', private readonly redirectUri = 'https://weeklid.crexative.com/api/auth/callback', private readonly nowSeconds: () => number = () => Math.floor(Date.now() / 1000)) {}

  issueCode(who: IssuedIdentity, binding: { challenge: string | null; nonce: string | null }): string {
    const code = `code-${++this.issued}-4/0AfakeSignInCode`
    this.codes.set(code, { ...who, ...binding, used: false })
    return code
  }

  /** The next token request gets this answer instead. */
  script(response: { status: number; body?: unknown } | 'hang'): void {
    this.scripted = response
  }

  readonly fetch: typeof fetch = async (input, init) => {
    const url = String(input instanceof Request ? input.url : input)
    const form = Object.fromEntries(new URLSearchParams(String(init?.body ?? '')))
    if (url !== `${this.origin}/token`) throw new TypeError('fetch to an unexpected host')
    this.calls.push({ url, form })
    const scripted = this.scripted
    this.scripted = null
    if (scripted === 'hang') {
      const signal = init?.signal
      return new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
    }
    const reply = scripted ?? await this.answer(form)
    return new Response(reply.body === undefined ? null : JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json' } })
  }

  private async answer(form: Record<string, string>): Promise<{ status: number; body?: unknown }> {
    if (form.client_id !== FAKE_ID.clientId || form.client_secret !== FAKE_ID.clientSecret) return { status: 401, body: { error: 'invalid_client' } }
    const issued = this.codes.get(form.code ?? '')
    if (!issued || issued.used || form.redirect_uri !== this.redirectUri) return { status: 400, body: { error: 'invalid_grant' } }
    if (issued.challenge !== null && (await sha256b64url(form.code_verifier ?? '')) !== issued.challenge) return { status: 400, body: { error: 'invalid_grant' } }
    issued.used = true
    const claims: Record<string, unknown> = {
      iss: 'https://accounts.google.com',
      aud: FAKE_ID.clientId,
      sub: issued.sub,
      email: issued.email,
      email_verified: issued.emailVerified ?? true,
      nonce: issued.nonce,
      iat: this.nowSeconds(),
      exp: this.nowSeconds() + 3600,
      ...issued.claims,
    }
    const part = (value: unknown): string => base64url(encoder.encode(JSON.stringify(value)))
    return { status: 200, body: { access_token: 'at-SECRET-123', expires_in: 3599, token_type: 'Bearer', scope: 'openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile', id_token: `${part({ alg: 'RS256' })}.${part(claims)}.c2ln` } }
  }
}
