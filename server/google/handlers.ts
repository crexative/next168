// The five Google routes (§4.4). Each handler depends only on the ports in `Deps`, so the tests drive it with
// in-process fakes and the Pages adapters in functions/ pass the real ones.
import type { ConnectionStore, Generation } from './connectionStore'
import {
  keyId, open, packSealed, pkceAad, pkceChallenge, randomId, seal, sha256b64url, timingSafeEqual, tokenAad, unpackSealed,
  type RandomSource,
} from './crypto'
import { authorizationUrl, exchangeCode, googleEndpoints, refreshAccessToken, revokeToken } from './googleOAuth'
import {
  errorClass, failure, guardHostAndSwitch, guardPost, hasExactKeys, json, jsonFallback, readCookie, readJsonObject, redirect,
  serve, setCookie, type ErrorClass, type Outcome, type Reply, type Runtime,
} from './http'

export interface Deps extends Runtime {
  /** Null exactly when the base configuration is missing. */
  store: ConnectionStore | null
  fetch: typeof fetch
  random: RandomSource
  deadlines: { googleMs: number; revokeMs: number }
}

export const DEVICE_COOKIE = '__Host-wl_dev'
export const FLOW_COOKIE = '__Host-wl_gflow'
const DEVICE_COOKIE_MAX_AGE = 34_560_000
const FLOW_COOKIE_MAX_AGE = 600
export const PENDING_TTL_S = 600
export const CREDENTIAL_IDLE_S = 190 * 86_400

const DEVICE_ID = /^[A-Za-z0-9_-]{43}$/
const ID22 = /^[A-Za-z0-9_-]{22}$/
const GENERATION = /^(-|[A-Za-z0-9_-]{22})\.(-|[A-Za-z0-9_-]{22})$/

const seconds = (deps: Deps): number => Math.floor(deps.now() / 1000)
const pendingCutoff = (deps: Deps): number => seconds(deps) - PENDING_TTL_S

function deviceIdFrom(request: Request): string | null {
  const value = readCookie(request, DEVICE_COOKIE)
  return value && DEVICE_ID.test(value) ? value : null
}

export const formatGeneration = (gen: Generation): string => `${gen.connectionId ?? '-'}.${gen.pendingId ?? '-'}`

function parseGeneration(raw: string): Generation | null {
  const match = GENERATION.exec(raw)
  if (!match) return null
  return { connectionId: match[1] === '-' ? null : match[1]!, pendingId: match[2] === '-' ? null : match[2]! }
}

const redirectUri = (appOrigin: string): string => `${appOrigin}/api/google/callback`

// --- POST /api/google/connect ---------------------------------------------------------------------------------------

export function handleConnect(request: Request, deps: Deps): Promise<Response> {
  return serve(deps, 'connect', async () => {
    const { config, store } = deps
    const stop = guardPost(request, config, { requireJson: false })
    if (stop) return stop
    if (!config.base || !store) return failure(503, 'notConfigured')
    const body = await readJsonObject(request)
    const from = body?.from
    if (!body || !hasExactKeys(body, ['from', 'epoch']) || (from !== 'app' && from !== 'canary') || typeof body.epoch !== 'string' || !ID22.test(body.epoch)) {
      return failure(400, 'badRequest')
    }
    const deviceId = deviceIdFrom(request) ?? randomId(deps.random, 32)
    const deviceHash = await sha256b64url(deviceId)
    const state = randomId(deps.random, 32)
    const verifier = randomId(deps.random, 32)
    const sealed = await seal(config.base.tokenKey, pkceAad(deviceHash), verifier, deps.random)
    try {
      await store.upsertPending({
        deviceHash,
        pendingId: randomId(deps.random, 16),
        stateHash: await sha256b64url(state),
        verifier: packSealed(sealed),
        keyId: await keyId(config.base.tokenKey),
        epoch: body.epoch,
        returnTo: from,
        createdAt: seconds(deps),
      })
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
    const url = authorizationUrl(googleEndpoints(config.googleOrigin), {
      clientId: config.base.clientId,
      redirectUri: redirectUri(config.appOrigin!),
      state,
      codeChallenge: await pkceChallenge(verifier),
    })
    return json(200, 'ok', { url }, {
      cookies: [
        setCookie(DEVICE_COOKIE, deviceId, DEVICE_COOKIE_MAX_AGE, 'Strict'),
        setCookie(FLOW_COOKIE, state, FLOW_COOKIE_MAX_AGE, 'Lax'),
      ],
    })
  }, jsonFallback)
}

// --- GET /api/google/callback ---------------------------------------------------------------------------------------

type CallbackResult = Extract<Outcome,
  'disabled' | 'notConfigured' | 'state' | 'storage' | 'denied' | 'auth' | 'canary' | 'cancelled' | 'exchange'
  | 'noRefreshToken' | 'missingScope' | 'connected' | 'error'>

// Writes no cookie. Every exit is a 303 to a fixed target chosen by the pending row's `return_to`; no request
// parameter is ever reflected.
export function handleCallback(request: Request, deps: Deps): Promise<Response> {
  const { config, store } = deps
  let target = (result: CallbackResult): string => `${config.appOrigin}/?google=${result}#/settings/calendars`
  const finish = (result: CallbackResult, error?: ErrorClass): Reply => redirect(target(result), result, error)

  return serve(deps, 'callback', async () => {
    const stop = guardHostAndSwitch(request, config)
    if (stop?.outcome === 'notFound') return stop
    if (stop) return finish('disabled')
    if (!config.base || !store) return finish('notConfigured')
    const base = config.base

    const params = new URL(request.url).searchParams
    const state = params.get('state')
    const flow = readCookie(request, FLOW_COOKIE)
    if (!state || !flow || !timingSafeEqual(flow, state)) return finish('state')
    const stateHash = await sha256b64url(state)
    let pending
    try {
      pending = await store.findPending(stateHash, pendingCutoff(deps))
    } catch (error) {
      return finish('storage', errorClass(error))
    }
    if (!pending) return finish('state')
    if (pending.returnTo === 'canary') target = (result) => `${config.appOrigin}/api/google/canary?google=${result}`
    const { deviceHash } = pending

    // Ends the pending authorization without storing anything; a storage failure is reported as such.
    const endPending = async (result: CallbackResult, whenAlreadyGone: CallbackResult = result): Promise<Reply> => {
      try {
        return finish((await store.deletePending(deviceHash, stateHash)) === 1 ? result : whenAlreadyGone)
      } catch (error) {
        return finish('storage', errorClass(error))
      }
    }

    const googleError = params.get('error')
    if (googleError !== null) return endPending(googleError === 'access_denied' ? 'denied' : 'auth')
    const code = params.get('code')
    if (!code) return endPending('auth')
    const clientSecret = config.clientSecret
    if (!clientSecret) return endPending('canary', 'cancelled')

    const currentKeyId = await keyId(base.tokenKey)
    const sealedVerifier = unpackSealed(pending.verifier)
    if (pending.keyId !== currentKeyId || !sealedVerifier) return finish('exchange')
    let verifier: string
    try {
      verifier = await open(base.tokenKey, pkceAad(deviceHash), sealedVerifier)
    } catch (error) {
      return finish('exchange', errorClass(error))
    }

    const endpoints = googleEndpoints(config.googleOrigin)
    const exchanged = await exchangeCode(deps.fetch, endpoints, { clientId: base.clientId, clientSecret }, {
      code, verifier, redirectUri: redirectUri(config.appOrigin!),
    }, deps.deadlines.googleMs)
    if (exchanged.kind === 'failed') return finish('exchange', exchanged.error)
    if (exchanged.kind === 'noRefreshToken' || exchanged.kind === 'missingScope') return endPending(exchanged.kind)

    const token = await seal(base.tokenKey, tokenAad(deviceHash), exchanged.refreshToken, deps.random)
    const now = seconds(deps)
    try {
      const committed = await store.commit({
        deviceHash,
        stateHash,
        connectionId: randomId(deps.random, 16),
        keyId: currentKeyId,
        iv: token.iv,
        ciphertext: token.ciphertext,
        now,
        pendingCutoff: now - PENDING_TTL_S,
        credentialCutoff: now - CREDENTIAL_IDLE_S,
      })
      // Not committed: the pending row was superseded, removed or expired. The token is discarded, not revoked.
      return finish(committed ? 'connected' : 'cancelled')
    } catch (error) {
      return finish('storage', errorClass(error))
    }
  }, (error) => (config.appOrigin ? finish('error', error) : failure(404, 'notFound')))
}

// --- POST /api/google/token -----------------------------------------------------------------------------------------

export function handleToken(request: Request, deps: Deps): Promise<Response> {
  return serve(deps, 'token', async () => {
    const { config, store } = deps
    const stop = guardPost(request, config, { requireJson: false })
    if (stop) return stop
    if (!config.base || !store) return failure(503, 'notConfigured')
    const base = config.base
    const deviceId = deviceIdFrom(request)
    if (!deviceId) return failure(401, 'noDevice')
    const deviceHash = await sha256b64url(deviceId)

    let read
    try {
      read = await store.mintRead(deviceHash, pendingCutoff(deps))
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
    const credential = read.credential
    if (!credential) return failure(401, 'notConnected')
    const currentKeyId = await keyId(base.tokenKey)
    if (credential.keyId !== currentKeyId) return failure(401, 'reconnect')
    let refreshToken: string
    try {
      refreshToken = await open(base.tokenKey, tokenAad(deviceHash), credential)
    } catch (error) {
      return failure(401, 'reconnect', errorClass(error))
    }
    if (!config.clientSecret) return failure(503, 'notConfigured')

    const refreshed = await refreshAccessToken(
      deps.fetch, googleEndpoints(config.googleOrigin), { clientId: base.clientId, clientSecret: config.clientSecret }, refreshToken, deps.deadlines.googleMs,
    )
    switch (refreshed.kind) {
      case 'ok': {
        // Every write is conditional on this credential; a failed or zero-row write does not fail the mint.
        let writeError: ErrorClass | undefined
        const note = (error: unknown): void => {
          writeError ??= errorClass(error)
        }
        const now = seconds(deps)
        await store.touch(deviceHash, credential.connectionId, now).catch(note)
        if (refreshed.rotatedRefreshToken) {
          const rotated = await seal(base.tokenKey, tokenAad(deviceHash), refreshed.rotatedRefreshToken, deps.random)
          await store.rotate(deviceHash, credential.connectionId, { keyId: currentKeyId, ...rotated }).catch(note)
        }
        await store.sweep({ pendingCutoff: now - PENDING_TTL_S, credentialCutoff: now - CREDENTIAL_IDLE_S }).catch(note)
        return json(200, 'ok', { accessToken: refreshed.accessToken, expiresIn: refreshed.expiresIn, epoch: credential.epoch, pending: read.pending }, { error: writeError })
      }
      case 'missingScope':
        return failure(401, 'reconnect')
      case 'invalidGrant': {
        let deleteError: ErrorClass | undefined
        await store.deleteCredential(deviceHash, credential.connectionId).catch((error: unknown) => {
          deleteError = errorClass(error)
        })
        return failure(401, 'reconnect', deleteError)
      }
      case 'clientRejected':
        return failure(503, 'serverConfig')
      case 'unavailable':
        return failure(502, 'googleUnavailable', refreshed.error)
    }
  }, jsonFallback)
}

// --- POST /api/google/status ----------------------------------------------------------------------------------------

export function handleStatus(request: Request, deps: Deps): Promise<Response> {
  return serve(deps, 'status', async () => {
    const { config, store } = deps
    const stop = guardPost(request, config, { requireJson: false })
    if (stop) return stop
    if (!config.base || !store) return failure(503, 'notConfigured')
    const deviceId = deviceIdFrom(request)
    if (!deviceId) return json(200, 'ok', { gen: '-.-', connected: false, pending: false })
    let gen: Generation
    try {
      gen = await store.status(await sha256b64url(deviceId), pendingCutoff(deps))
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
    return json(200, 'ok', { gen: formatGeneration(gen), connected: gen.connectionId !== null, pending: gen.pendingId !== null })
  }, jsonFallback)
}

// --- POST /api/google/disconnect: generation-fenced ----------------------------------------------------------------

export function handleDisconnect(request: Request, deps: Deps): Promise<Response> {
  return serve(deps, 'disconnect', async () => {
    const { config, store } = deps
    const stop = guardPost(request, config, { requireJson: true })
    if (stop) return stop
    if (!config.base || !store) return failure(503, 'notConfigured')
    const base = config.base
    const body = await readJsonObject(request)
    const expected = body && hasExactKeys(body, ['revoke', 'gen']) && typeof body.revoke === 'boolean' && typeof body.gen === 'string'
      ? parseGeneration(body.gen)
      : null
    if (!body || !expected) return failure(400, 'badRequest')
    const deviceId = deviceIdFrom(request)
    if (!deviceId) return json(200, 'none', { result: 'none' })
    const deviceHash = await sha256b64url(deviceId)

    let result
    try {
      result = await store.disconnect(deviceHash, expected, pendingCutoff(deps))
    } catch (error) {
      return failure(503, 'storage', errorClass(error))
    }
    if (result.deleted) {
      if (body.revoke !== true) return json(200, 'forgotten', { result: 'forgotten' })
      const sealed = result.deleted
      let token: string | null = null
      if (sealed.keyId === await keyId(base.tokenKey)) {
        token = await open(base.tokenKey, tokenAad(deviceHash), sealed).catch(() => null)
      }
      const confirmed = token !== null && await revokeToken(deps.fetch, googleEndpoints(config.googleOrigin), token, deps.deadlines.revokeMs)
      return confirmed ? json(200, 'confirmed', { result: 'confirmed' }) : json(200, 'unconfirmed', { result: 'unconfirmed' })
    }
    if (result.after.connectionId === null && result.after.pendingId === null) return json(200, 'none', { result: 'none' })
    return json(200, 'stale', { result: 'stale', gen: formatGeneration(result.after) })
  }, jsonFallback)
}
