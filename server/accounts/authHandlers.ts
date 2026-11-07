// The five account routes. Each handler depends only on the ports in `AccountsDeps`, so the tests drive it with in-process
// fakes and the Pages adapters in functions/ pass the real ones.
import { open, pkceChallenge, randomId, seal, sha256b64url, packSealed, unpackSealed } from '../google/crypto'
import {
  errorClass, failure, hasExactKeys, json, jsonFallback, readCookie, readJsonObject, redirect, serve, setCookie,
  type ErrorClass, type Outcome, type Reply,
} from '../google/http'
import { exchangeIdentityCode, googleEndpoints, signInUrl } from './identity'
import {
  CONSENT_VERSION, FLOW_COOKIE, PENDING_TTL_S, SESSION_COOKIE, SESSION_IDLE_S, TOKEN_PATTERN, admit, clearCookie, currentSession,
  isReply, seconds, sessionCookieOf, switchedOff, withCookies, type AccountsDeps,
} from './session'

const SESSION_COOKIE_MAX_AGE = SESSION_IDLE_S
const redirectUri = (appOrigin: string): string => `${appOrigin}/api/auth/callback`
const verifierAad = (stateHash: string): string => `weeklid/auth/pkce/v1/${stateHash}`

// --- POST /api/auth/start --------------------------------------------------------------------------------------------

export function handleStart(request: Request, deps: AccountsDeps): Promise<Response> {
  return serve(deps, 'auth.start', async () => {
    const admitted = await admit(request, deps, { method: 'write', requireJson: true })
    if (isReply(admitted)) return admitted
    const { base, store } = admitted
    const body = await readJsonObject(request)
    if (!body || !hasExactKeys(body, ['consent']) || body.consent !== CONSENT_VERSION) return failure(400, 'badRequest')

    const state = randomId(deps.random, 32)
    const flow = randomId(deps.random, 32)
    const verifier = randomId(deps.random, 32)
    const nonce = randomId(deps.random, 16)
    const stateHash = await sha256b64url(state)
    const sealed = await seal(base.syncKey, verifierAad(stateHash), verifier, deps.random)
    const now = seconds(deps)
    try {
      await store.putPending({
        stateHash, flowHash: await sha256b64url(flow), verifier: packSealed(sealed), nonce, consentVersion: CONSENT_VERSION, createdAt: now,
      }, now - PENDING_TTL_S)
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
    const url = signInUrl(googleEndpoints(deps.config.googleOrigin), {
      clientId: base.clientId, redirectUri: redirectUri(deps.config.appOrigin!), state, nonce, codeChallenge: await pkceChallenge(verifier),
    })
    return json(200, 'ok', { url }, { cookies: [setCookie(FLOW_COOKIE, flow, PENDING_TTL_S, 'Lax')] })
  }, jsonFallback)
}

// --- GET /api/auth/callback ------------------------------------------------------------------------------------------

type CallbackResult = Extract<Outcome,
  'notConfigured' | 'state' | 'storage' | 'denied' | 'auth' | 'exchange' | 'signedIn' | 'accountDeleted' | 'notInvited' | 'error'>

// Google's redirect is a cross-site top-level GET, which carries the Lax flow cookie. Every exit is a 303 to a fixed app
// address; no request parameter is ever reflected, and the flow cookie ends with the first use.
export function handleCallback(request: Request, deps: AccountsDeps): Promise<Response> {
  const { config, store } = deps
  const target = (result: CallbackResult): string => `${config.appOrigin}/?account=${result}#/settings/account`
  const finish = (result: CallbackResult, error?: ErrorClass, cookies: string[] = []): Reply =>
    withCookies(redirect(target(result), result, error), cookies)
  // Once the pending row is consumed the flow cookie has done its job. Before that nothing is cleared, so a foreign
  // callback cannot cancel someone else's sign-in in progress.
  const used = (result: CallbackResult, error?: ErrorClass): Reply => finish(result, error, [clearCookie(FLOW_COOKIE)])

  return serve(deps, 'auth.callback', async () => {
    const off = switchedOff(request, config)
    if (off) return off
    if (!config.base || !store) return finish('notConfigured')
    const base = config.base
    try {
      if (!await store.migrated()) return finish('notConfigured')
    } catch (error) {
      return finish('storage', errorClass(error))
    }

    const params = new URL(request.url).searchParams
    const state = params.get('state')
    const flow = readCookie(request, FLOW_COOKIE)
    if (!state || !flow || !TOKEN_PATTERN.test(state) || !TOKEN_PATTERN.test(flow)) return finish('state')
    const now = seconds(deps)
    const stateHash = await sha256b64url(state)
    let pending
    try {
      pending = await store.consumePending(stateHash, await sha256b64url(flow), now - PENDING_TTL_S)
    } catch (error) {
      return finish('storage', errorClass(error))
    }
    if (!pending) return finish('state')

    const googleError = params.get('error')
    if (googleError !== null) return used(googleError === 'access_denied' ? 'denied' : 'auth')
    const code = params.get('code')
    if (!code) return used('auth')
    const sealedVerifier = unpackSealed(pending.verifier)
    if (!sealedVerifier) return used('exchange')
    let verifier: string
    try {
      verifier = await open(base.syncKey, verifierAad(stateHash), sealedVerifier)
    } catch (error) {
      return used('exchange', errorClass(error))
    }

    const exchanged = await exchangeIdentityCode(
      deps.fetch, googleEndpoints(config.googleOrigin), { clientId: base.clientId, clientSecret: base.clientSecret },
      { code, verifier, redirectUri: redirectUri(config.appOrigin!), nonce: pending.nonce }, now, deps.deadlineMs,
    )
    if (exchanged.kind === 'failed') return used('exchange', exchanged.error)
    if (exchanged.kind === 'invalid') return used('auth')
    const { identity } = exchanged

    // A fresh token on every sign-in: nothing from before the callback becomes the session, and only its hash is stored.
    const token = randomId(deps.random, 32)
    const tokenHash = await sha256b64url(token)
    const presented = sessionCookieOf(request)
    const accountKey = await sha256b64url(identity.sub)
    try {
      if (await store.isDeleted(accountKey)) return used('accountDeleted')
      const existing = await store.findAccountId(identity.sub)
      const started = existing
        ? await store.signIn({
          accountId: existing, sub: identity.sub, email: identity.email, tokenHash, replacedTokenHash: presented ? await sha256b64url(presented) : null, now,
        })
        : await store.signUp({
          accountId: randomId(deps.random, 16), accountKey, sub: identity.sub, email: identity.email, consentVersion: pending.consentVersion,
          tokenHash, now, idleCutoff: now - SESSION_IDLE_S,
        })
      if (!started) return used('notInvited')
    } catch (error) {
      return used('storage', errorClass(error))
    }
    return finish('signedIn', undefined, [clearCookie(FLOW_COOKIE), setCookie(SESSION_COOKIE, token, SESSION_COOKIE_MAX_AGE, 'Lax')])
  }, (error) => (config.appOrigin ? finish('error', error) : failure(404, 'notFound')))
}

// --- POST /api/auth/session ------------------------------------------------------------------------------------------

export function handleSession(request: Request, deps: AccountsDeps): Promise<Response> {
  return serve(deps, 'auth.session', async () => {
    const admitted = await admit(request, deps, { method: 'write', requireJson: false })
    if (isReply(admitted)) return admitted
    let session
    try {
      session = await currentSession(request, deps, admitted.store)
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
    if (!session) return json(200, 'signedOut', { signedIn: false })
    return json(200, 'ok', { signedIn: true, accountKey: session.accountKey, email: session.email, consentVersion: session.consentVersion })
  }, jsonFallback)
}

// --- POST /api/auth/signout ------------------------------------------------------------------------------------------

export function handleSignOut(request: Request, deps: AccountsDeps): Promise<Response> {
  return serve(deps, 'auth.signout', async () => {
    const admitted = await admit(request, deps, { method: 'write', requireJson: false })
    if (isReply(admitted)) return admitted
    const token = sessionCookieOf(request)
    try {
      if (token) await admitted.store.endSession(await sha256b64url(token))
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
    return json(200, 'signedOut', { signedIn: false }, { cookies: [clearCookie(SESSION_COOKIE)] })
  }, jsonFallback)
}

// --- POST /api/auth/delete -------------------------------------------------------------------------------------------

export function handleDeleteAccount(request: Request, deps: AccountsDeps): Promise<Response> {
  return serve(deps, 'auth.delete', async () => {
    const admitted = await admit(request, deps, { method: 'write', requireJson: true })
    if (isReply(admitted)) return admitted
    const body = await readJsonObject(request)
    if (!body || !hasExactKeys(body, ['accountKey']) || typeof body.accountKey !== 'string') return failure(400, 'badRequest')
    try {
      const session = await currentSession(request, deps, admitted.store)
      if (!session) return failure(401, 'unauthorized')
      if (body.accountKey !== session.accountKey) return failure(409, 'accountMismatch')
      await admitted.store.deleteAccount(session.accountId)
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
    return json(200, 'accountRemoved', { removed: true }, { cookies: [clearCookie(SESSION_COOKIE)] })
  }, jsonFallback)
}
