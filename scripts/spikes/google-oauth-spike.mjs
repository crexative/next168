#!/usr/bin/env node
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer } from 'node:http'
import { pathToFileURL } from 'node:url'

const testOriginKey = 'WEEKLID_OAUTH_SPIKE_TEST_ORIGIN'
const syntheticSecret = 'weeklid-test-only-synthetic-secret'
const redirectUri = 'http://localhost:8788/api/google/callback'
const scope = 'https://www.googleapis.com/auth/calendar.events.readonly'
const finalLine = 'Now remove Weeklid at myaccount.google.com/connections.'
const randomValue = () => randomBytes(32).toString('base64url')
const testMode = () => Object.hasOwn(process.env, testOriginKey)

export function assertRuntime(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  const supportedVersion = (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major >= 23
  if (!supportedVersion || typeof AbortSignal.any !== 'function') throw new Error('nodeVersion')
}

export function parseClientId(args) {
  if (args.length !== 2 || args[0] !== '--client-id' || !/^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*\.apps\.googleusercontent\.com$/.test(args[1])) throw new Error('client ID')
  return args[1]
}

function endpoints() {
  if (!testMode()) return {
    authorization: 'https://accounts.google.com/o/oauth2/v2/auth',
    token: 'https://oauth2.googleapis.com/token',
    revoke: 'https://oauth2.googleapis.com/revoke',
    events: 'https://www.googleapis.com/calendar/v3/calendars/primary/events',
  }
  const origin = process.env[testOriginKey]
  // Presence always disables TTY input, even if validation below fails.
  if (!/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}$/.test(origin) || new URL(origin).port === '') throw new Error('test origin')
  return Object.fromEntries(['authorization', 'token', 'revoke', 'events'].map(key => [key, `${origin}/${key === 'authorization' ? 'auth' : key}`]))
}

export function createSecretPrompt(tty, write, signal, interrupt) {
  let used = false, hidden = false
  const restore = () => {
    if (hidden) {
      tty.setRawMode(false)
      hidden = false
    }
  }
  return {
    restore,
    async read() {
      if (used || testMode() || !tty.isTTY || signal.aborted) throw new Error('TTY unavailable')
      used = true
      let value = ''
      let detach = () => {}
      try {
        // Raw mode disables echo as well as terminal-generated signals; handle Ctrl-C below.
        hidden = true
        tty.setRawMode(true)
        write('Client secret (hidden): ')
        return await new Promise((resolve, reject) => {
          const fail = () => reject(new Error('input interrupted'))
          const data = chunk => {
            for (const character of chunk.toString('utf8')) {
              if (character === '\u0003') { interrupt(); return }
              if (character === '\u0004') { fail(); return }
              if (character === '\r' || character === '\n') {
                if (!value) fail()
                else resolve(value)
                return
              }
              if (character === '\u007f' || character === '\b') value = value.slice(0, -1)
              else if (character >= ' ' && value.length < 4096) value += character
            }
          }
          tty.on('data', data)
          tty.on('error', fail)
          tty.on('end', fail)
          signal.addEventListener('abort', fail, { once: true })
          detach = () => {
            tty.off('data', data); tty.off('error', fail); tty.off('end', fail)
            signal.removeEventListener('abort', fail)
          }
          tty.resume()
        })
      } finally {
        restore()
        detach()
        tty.pause()
        value = ''
        write('\n')
      }
    },
  }
}

export function installSignalHandlers(signals, controller, restore) {
  const handlers = new Map(['SIGINT', 'SIGTERM'].map(signal => [signal, () => {
    try { restore() } finally { controller.abort(new Error(signal)) }
  }]))
  for (const [signal, handler] of handlers) signals.on(signal, handler)
  return () => { for (const [signal, handler] of handlers) signals.off(signal, handler) }
}

export async function consent(clientId, urls, signal, print, createListener = createServer) {
  const state = randomValue(), verifier = randomValue()
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  const authorization = new URL(urls.authorization)
  authorization.search = new URLSearchParams({
    client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope,
    access_type: 'offline', prompt: 'consent', state,
    code_challenge: challenge, code_challenge_method: 'S256',
  }).toString()
  let settle, fail
  const callback = new Promise((resolve, reject) => { settle = resolve; fail = reject })
  // Attach immediately, including listener startup failures.
  callback.catch(() => {})
  const bounded = AbortSignal.any([signal, AbortSignal.timeout(5 * 60 * 1000)])
  let received = false
  const handler = (req, res) => {
    res.setHeader('Cache-Control', 'no-store')
    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
    res.setHeader('Referrer-Policy', 'no-referrer')
    const rejectCallback = () => {
      res.once('finish', () => {
        print('callback stateMismatch no 400')
        fail(new Error('callback rejected'))
      })
      res.writeHead(400); res.end('no')
    }
    let url
    try { url = new URL(req.url, redirectUri) } catch { rejectCallback(); return }
    if (req.method !== 'GET' || url.pathname !== '/api/google/callback') {
      res.writeHead(404); res.end('no'); return
    }
    if (received) { res.writeHead(409); res.end('no'); return }
    const returnedState = Buffer.from(url.searchParams.get('state') ?? '')
    const expectedState = Buffer.from(state)
    const validState = returnedState.length === expectedState.length && timingSafeEqual(returnedState, expectedState)
    const code = url.searchParams.get('code')
    if (!validState || url.searchParams.getAll('state').length !== 1 || !code || url.searchParams.getAll('code').length !== 1 || url.searchParams.has('error')) {
      rejectCallback()
    } else {
      received = true
      res.once('finish', () => settle({ code, verifier }))
      res.writeHead(200); res.end('You can close this tab')
    }
  }
  // Explicit loopback sockets cover both localhost resolutions without exposing a wildcard listener.
  const servers = []
  const abort = () => fail(new Error('consentTimeout'))
  bounded.addEventListener('abort', abort, { once: true })
  try {
    if (bounded.aborted) throw new Error('consent interrupted')
    for (const options of [{ port: 8788, host: '127.0.0.1' }, { port: 8788, host: '::1', ipv6Only: true }]) {
      const server = createListener(handler)
      servers.push(server)
      await new Promise((resolve, reject) => {
        const interrupted = () => reject(new Error('consentTimeout'))
        const ready = () => { bounded.removeEventListener('abort', interrupted); resolve() }
        server.once('error', error => { bounded.removeEventListener('abort', interrupted); reject(error); fail(error) })
        bounded.addEventListener('abort', interrupted, { once: true })
        if (bounded.aborted) { interrupted(); return }
        server.listen(options, ready)
      })
    }
    print(authorization.href)
    return await callback
  } finally {
    bounded.removeEventListener('abort', abort)
    for (const server of servers) {
      server.closeAllConnections()
      await new Promise(resolve => server.close(resolve))
    }
  }
}

export async function request(url, body, signal, timeout = 15000, authorization) {
  try {
    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      ...(body ? { body: new URLSearchParams(body) } : {}),
      ...(authorization ? { headers: { Authorization: `Bearer ${authorization}` } } : {}),
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout),
    })
    let data = {}
    try { data = await response.json() } catch (error) {
      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error
      // Revocation can return an empty body; malformed JSON contains no retained fields.
    }
    // Raw bodies and descriptions never leave this request; retain only values needed in memory.
    return {
      status: response.status,
      error: typeof data?.error === 'string' && /^[a-z_]{1,40}$/.test(data.error) ? data.error : undefined,
      refreshToken: typeof data?.refresh_token === 'string' ? data.refresh_token : undefined,
      accessToken: typeof data?.access_token === 'string' ? data.access_token : undefined,
      hasScope: typeof data?.scope === 'string' && data.scope.split(' ').includes(scope),
      expiryNearHour: Number.isFinite(data?.expires_in) && Math.abs(data.expires_in - 3600) <= 300,
    }
  } catch { return { status: 0 } }
}

export async function run(clientId, secret, urls, signal, print, tokens, authorize = consent) {
  const report = (label, yes, status) => print(`${label} ${yes ? 'yes' : 'no'} ${status}`)
  const remember = result => {
    const token = result.refreshToken
    if (typeof token === 'string' && token) tokens.add(token)
    return token
  }
  const exchange = async (label, mode = 'correct') => {
    const { code, verifier } = await authorize(clientId, urls, signal, print)
    const result = await request(urls.token, {
      grant_type: 'authorization_code', client_id: clientId, code, redirect_uri: redirectUri,
      ...(mode === 'omitted' ? {} : { code_verifier: mode === 'wrong' ? randomValue() : verifier }),
      ...(mode === 'no-secret' ? {} : { client_secret: secret }),
    }, signal)
    const token = remember(result)
    report(`${label} exchange`, result.status === 200, result.status)
    if (result.error) print(`${label} error ${result.error} ${result.status}`)
    if (mode !== 'correct' && token) report(`${label} unexpected-token`, true, result.status)
    if (result.status === 0) throw new Error('requestUnavailable')
    return result
  }
  const requiredExchange = async label => {
    const result = await exchange(label)
    const hasRefresh = typeof result.refreshToken === 'string' && !!result.refreshToken
    const hasScope = result.hasScope
    report(`${label} refresh-token`, hasRefresh, result.status)
    report(`${label} events-scope`, hasScope, result.status)
    if (result.status !== 200 || !hasRefresh || !hasScope) throw new Error('redesign required')
    return result.refreshToken
  }
  const refresh = async token => {
    const result = await request(urls.token, {
      grant_type: 'refresh_token', client_id: clientId, client_secret: secret, refresh_token: token,
    }, signal)
    remember(result)
    return result
  }
  const rt1 = await requiredExchange('P1')
  for (const [label, mode] of [['P2a', 'wrong'], ['P2b', 'omitted'], ['P2c', 'no-secret']]) {
    const result = await exchange(label, mode)
    const rejected = label === 'P2a' ? result.status === 400 && result.error === 'invalid_grant'
      : label === 'P2b' ? result.status === 400 : [400, 401].includes(result.status)
    report(`${label} rejected`, rejected, result.status)
  }
  const rt2 = await requiredExchange('P1′')
  // The owner contract requires fresh authorization for P3/P4 as well as the five exchange probes.
  await requiredExchange('P3')
  const p3 = await refresh(rt1)
  report('P3 refresh', p3.status === 200, p3.status)
  if (p3.status === 0) throw new Error('requestUnavailable')
  report('P3 expiry', p3.expiryNearHour, p3.status)
  if (typeof p3.accessToken === 'string' && p3.accessToken) {
    const eventsUrl = new URL(urls.events)
    eventsUrl.searchParams.set('maxResults', '1')
    const events = await request(eventsUrl, undefined, signal, 15000, p3.accessToken)
    report('P3 events', events.status === 200, events.status)
    if (events.status === 0) throw new Error('requestUnavailable')
  } else report('P3 events', false, 0)
  await requiredExchange('P4')
  const revoked = await request(urls.revoke, { token: rt1 }, signal, 5000)
  report('P4 revoke', revoked.status === 200, revoked.status)
  if (revoked.status === 0) throw new Error('requestUnavailable')
  const p4 = await refresh(rt2)
  report('P4 other-refresh-survives', p4.status === 200 && typeof p4.accessToken === 'string', p4.status)
  report('P4 invalid-grant', p4.status === 400 && p4.error === 'invalid_grant', p4.status)
  if (p4.error) print(`P4 error ${p4.error} ${p4.status}`)
  if (p4.status === 0) throw new Error('requestUnavailable')
}

export async function cleanupTokens(tokens, urls, print) {
  let number = 0
  for (const token of tokens) {
    // Cleanup has its own deadline, independent of consent/network cancellation.
    const result = await request(urls.revoke, { token }, undefined, 5000)
    const status = result.status === 200 ? 'ok' : result.status === 0 ? 'unknown' : 'failed'
    print(`cleanup ${++number} ${status} ${result.status}`)
  }
}

async function main() {
  const print = line => process.stdout.write(line + '\n')
  const tokens = new Set(), controller = new AbortController()
  const prompt = createSecretPrompt(process.stdin, text => process.stderr.write(text), controller.signal, () => process.emit('SIGINT'))
  const uninstall = installSignalHandlers(process, controller, prompt.restore)
  process.on('exit', prompt.restore)
  let secret, urls
  try {
    assertRuntime()
    const clientId = parseClientId(process.argv.slice(2))
    urls = endpoints()
    print('Preconditions (verify in Google Console): Calendar API enabled; owner is a test user; http://localhost:8788/api/google/callback registered.')
    secret = testMode() ? syntheticSecret : await prompt.read()
    await run(clientId, secret, urls, controller.signal, print, tokens)
  } catch {
    process.exitCode = 2
    print('run no 0')
  } finally {
    try {
      prompt.restore()
      secret = undefined
      await cleanupTokens(tokens, urls, print)
    } finally {
      if (controller.signal.aborted) process.exitCode = 130
      tokens.clear()
      uninstall()
      process.off('exit', prompt.restore)
      print(finalLine)
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
