// Google sign-in: the authorization URL (openid, email and profile only), the code exchange, and the ID token checks.
// The ID token arrives straight from Google's token endpoint over HTTPS, which authenticates it (OpenID Connect Core 3.1.3.7),
// so its signature is not verified; iss, aud, exp and nonce are.
import { fromBase64url } from '../google/crypto'
import { googleEndpoints, postForm, stringField, type GoogleEndpoints } from '../google/googleOAuth'
import { errorClass, type ErrorClass } from '../google/http'

export const IDENTITY_SCOPE = 'openid email profile'
const ISSUERS: readonly string[] = ['https://accounts.google.com', 'accounts.google.com']

export { googleEndpoints }

export function signInUrl(endpoints: GoogleEndpoints, request: { clientId: string; redirectUri: string; state: string; nonce: string; codeChallenge: string }): string {
  const url = new URL(endpoints.auth)
  // No access_type=offline: sign-in stores no Google token and never reaches the calendar.
  url.search = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: 'code',
    scope: IDENTITY_SCOPE,
    prompt: 'select_account',
    state: request.state,
    nonce: request.nonce,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

export interface Identity {
  sub: string
  email: string
}

export type IdentityResult =
  | { kind: 'ok'; identity: Identity }
  | { kind: 'invalid' }
  | { kind: 'failed'; error?: ErrorClass }

export function claimsOf(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split('.')
  if (parts.length !== 3 || !parts[1]) return null
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(fromBase64url(parts[1])))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export function checkClaims(claims: Record<string, unknown> | null, expected: { clientId: string; nonce: string; nowSeconds: number }): Identity | null {
  if (!claims) return null
  const { iss, aud, exp, nonce, sub, email, email_verified: verified } = claims
  if (typeof iss !== 'string' || !ISSUERS.includes(iss)) return null
  if (aud !== expected.clientId) return null
  if (typeof exp !== 'number' || exp <= expected.nowSeconds) return null
  if (typeof nonce !== 'string' || nonce !== expected.nonce) return null
  if (typeof sub !== 'string' || sub.length === 0 || sub.length > 255) return null
  if (typeof email !== 'string' || email.length === 0 || email.length > 320 || verified !== true) return null
  return { sub, email: email.toLowerCase() }
}

export async function exchangeIdentityCode(
  fetcher: typeof fetch,
  endpoints: GoogleEndpoints,
  client: { clientId: string; clientSecret: string },
  grant: { code: string; verifier: string; redirectUri: string; nonce: string },
  nowSeconds: number,
  deadlineMs: number,
): Promise<IdentityResult> {
  let response
  try {
    response = await postForm(fetcher, endpoints.token, {
      grant_type: 'authorization_code',
      code: grant.code,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      redirect_uri: grant.redirectUri,
      code_verifier: grant.verifier,
    }, deadlineMs)
  } catch (error) {
    return { kind: 'failed', error: errorClass(error) }
  }
  if (response.status !== 200) return { kind: 'failed' }
  const idToken = stringField(response.body, 'id_token')
  if (!idToken) return { kind: 'invalid' }
  const identity = checkClaims(claimsOf(idToken), { clientId: client.clientId, nonce: grant.nonce, nowSeconds })
  return identity ? { kind: 'ok', identity } : { kind: 'invalid' }
}
