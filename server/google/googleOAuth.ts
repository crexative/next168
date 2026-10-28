// Google's OAuth endpoints, each call bounded by a deadline, every failure mapped to a closed set of results.
import { errorClass, type ErrorClass } from './http'

export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'

export interface GoogleEndpoints {
  auth: string
  token: string
  revoke: string
}

// `testOrigin` is honoured only after config.ts has checked it is a `.test` origin (S-2).
export function googleEndpoints(testOrigin: string | null): GoogleEndpoints {
  const accounts = testOrigin ?? 'https://accounts.google.com'
  const oauth2 = testOrigin ?? 'https://oauth2.googleapis.com'
  return { auth: `${accounts}/o/oauth2/v2/auth`, token: `${oauth2}/token`, revoke: `${oauth2}/revoke` }
}

export interface AuthorizationRequest {
  clientId: string
  redirectUri: string
  state: string
  codeChallenge: string
}

export function authorizationUrl(endpoints: GoogleEndpoints, request: AuthorizationRequest): string {
  const url = new URL(endpoints.auth)
  url.search = new URLSearchParams({
    client_id: request.clientId,
    redirect_uri: request.redirectUri,
    response_type: 'code',
    scope: CALENDAR_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: request.state,
    code_challenge: request.codeChallenge,
    code_challenge_method: 'S256',
  }).toString()
  return url.toString()
}

export interface ClientCredentials {
  clientId: string
  clientSecret: string
}

type Fetch = typeof fetch

interface TokenResponse {
  status: number
  body: Record<string, unknown> | null
}

async function postForm(fetcher: Fetch, url: string, form: Record<string, string>, deadlineMs: number): Promise<TokenResponse> {
  const response = await fetcher(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
    signal: AbortSignal.timeout(deadlineMs),
  })
  let body: Record<string, unknown> | null = null
  try {
    const parsed: unknown = await response.json()
    if (parsed && typeof parsed === 'object') body = parsed as Record<string, unknown>
  } catch {
    body = null
  }
  return { status: response.status, body }
}

const stringField = (body: Record<string, unknown> | null, name: string): string | null => {
  const value = body?.[name]
  return typeof value === 'string' && value.length > 0 ? value : null
}

const grantsCalendar = (scope: string | null): boolean => (scope ?? '').split(/\s+/).includes(CALENDAR_SCOPE)

export type ExchangeResult =
  | { kind: 'ok'; refreshToken: string }
  | { kind: 'noRefreshToken' }
  | { kind: 'missingScope' }
  | { kind: 'failed'; error?: ErrorClass }

export async function exchangeCode(
  fetcher: Fetch,
  endpoints: GoogleEndpoints,
  client: ClientCredentials,
  grant: { code: string; verifier: string; redirectUri: string },
  deadlineMs: number,
): Promise<ExchangeResult> {
  let response: TokenResponse
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
  const refreshToken = stringField(response.body, 'refresh_token')
  if (!refreshToken) return { kind: 'noRefreshToken' }
  if (!grantsCalendar(stringField(response.body, 'scope'))) return { kind: 'missingScope' }
  return { kind: 'ok', refreshToken }
}

export type RefreshResult =
  | { kind: 'ok'; accessToken: string; expiresIn: number; rotatedRefreshToken: string | null }
  | { kind: 'missingScope' }
  | { kind: 'invalidGrant' }
  | { kind: 'clientRejected' }
  | { kind: 'unavailable'; error?: ErrorClass }

export async function refreshAccessToken(
  fetcher: Fetch,
  endpoints: GoogleEndpoints,
  client: ClientCredentials,
  refreshToken: string,
  deadlineMs: number,
): Promise<RefreshResult> {
  let response: TokenResponse
  try {
    response = await postForm(fetcher, endpoints.token, {
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: client.clientId,
      client_secret: client.clientSecret,
    }, deadlineMs)
  } catch (error) {
    return { kind: 'unavailable', error: errorClass(error) }
  }
  const code = stringField(response.body, 'error')
  if (response.status === 200) {
    const accessToken = stringField(response.body, 'access_token')
    const expiresIn = response.body?.expires_in
    if (!accessToken || typeof expiresIn !== 'number') return { kind: 'unavailable' }
    if (!grantsCalendar(stringField(response.body, 'scope'))) return { kind: 'missingScope' }
    const rotated = stringField(response.body, 'refresh_token')
    return { kind: 'ok', accessToken, expiresIn, rotatedRefreshToken: rotated && rotated !== refreshToken ? rotated : null }
  }
  if (code === 'invalid_grant') return { kind: 'invalidGrant' }
  if (code === 'invalid_client' || code === 'unauthorized_client') return { kind: 'clientRejected' }
  return { kind: 'unavailable' }
}

// True only on Google's 200; anything else, including a timeout, is reported as unconfirmed.
export async function revokeToken(fetcher: Fetch, endpoints: GoogleEndpoints, token: string, deadlineMs: number): Promise<boolean> {
  try {
    const response = await fetcher(endpoints.revoke, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString(),
      signal: AbortSignal.timeout(deadlineMs),
    })
    return response.status === 200
  } catch {
    return false
  }
}
