import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createHash } from 'node:crypto'
import { EventEmitter, once } from 'node:events'
import { createServer } from 'node:http'
import { realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { test } from 'node:test'

const script = realpathSync(process.env.WEEKLID_SPIKE_TEST_SCRIPT ?? fileURLToPath(new URL('./google-oauth-spike.mjs', import.meta.url)))
const clientId = '123456789-synthetic.apps.googleusercontent.com'
const syntheticSecret = 'weeklid-test-only-synthetic-secret'
const finalLine = 'Now remove Weeklid at myaccount.google.com/connections.'
const scope = 'https://www.googleapis.com/auth/calendar.events.readonly'

async function runFake(options = {}) {
  const authorizations = [], exchanges = [], refreshes = [], revocations = [], events = [], privateValues = [syntheticSecret]
  const tokens = new Set()
  const operations = []
  const issues = []
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost')
      const chunks = []
      for await (const chunk of req) chunks.push(chunk)
      const form = new URLSearchParams(Buffer.concat(chunks).toString())
      assert.ok(!req.url.includes(syntheticSecret))
      assert.ok(!JSON.stringify(req.headers).includes(syntheticSecret))
      res.setHeader('Content-Type', 'application/json')
      const reply = (status, body) => { res.writeHead(status); res.end(JSON.stringify(body)) }
      if (url.pathname === '/auth') {
        authorizations.push(url)
        operations.push('consent')
        const code = `private-code-${authorizations.length}`
        privateValues.push(code)
        const callback = new URL(url.searchParams.get('redirect_uri'))
        callback.searchParams.set('code', code)
        callback.searchParams.set('state', (options.badState === true || options.badState === authorizations.length) ? 'wrong-state' : url.searchParams.get('state'))
        res.writeHead(302, { Location: callback.href })
        res.end()
      } else if (url.pathname === '/token' && form.get('grant_type') === 'authorization_code') {
        exchanges.push(form)
        operations.push('exchange')
        assert.match(req.headers['content-type'], /^application\/x-www-form-urlencoded(?:;|$)/)
        const number = Number(form.get('code').split('-').at(-1))
        const authorization = authorizations[number - 1]
        assert.equal(form.get('client_id'), clientId)
        assert.equal(form.get('redirect_uri'), 'http://localhost:8788/api/google/callback')
        const verifier = form.get('code_verifier')
        const validVerifier = verifier && createHash('sha256').update(verifier).digest('base64url') === authorization.searchParams.get('code_challenge')
        if (options.redirectToken) {
          res.writeHead(307, { Location: `${origin}/trap` }); res.end()
        } else if (options.unexpectedFailureToken && number === 2) {
          tokens.add('private-unexpected-refresh')
          privateValues.push('private-unexpected-refresh')
          reply(400, { error: 'invalid_grant', refresh_token: 'private-unexpected-refresh' })
        } else if (!options.acceptBadPkce && !validVerifier) reply(400, { error: 'invalid_grant', error_description: 'private-error-description' })
        else if (!form.get('client_secret') && !options.acceptNegativeTokens) reply(401, { error: 'invalid_client' })
        else {
          if (form.has('client_secret')) assert.equal(form.get('client_secret'), syntheticSecret)
          const refresh = `private-refresh-${number}`, access = `private-access-${number}`
          privateValues.push(refresh, access)
          if (!options.noRefresh) tokens.add(refresh)
          reply(200, { access_token: access, ...(options.noRefresh ? {} : { refresh_token: refresh }), scope, expires_in: 3600 })
        }
      } else if (url.pathname === '/token') {
        refreshes.push(form)
        operations.push('refresh')
        assert.equal(form.get('client_secret'), syntheticSecret)
        assert.equal(form.get('grant_type'), 'refresh_token')
        const revoked = revocations.includes('private-refresh-1')
        if (revoked && !options.survives) reply(400, { error: 'invalid_grant', error_description: 'private-error-description' })
        else {
          const access = `private-refreshed-access-${refreshes.length}`
          privateValues.push(access)
          reply(200, { access_token: access, expires_in: 3600 })
        }
      } else if (url.pathname === '/events') {
        operations.push('events')
        events.push({ url, authorization: req.headers.authorization })
        reply(200, { items: [{ summary: 'private-event-data', organizer: { email: 'private@example.test' } }] })
      } else if (url.pathname === '/revoke') {
        assert.equal(req.method, 'POST')
        assert.equal(form.get('client_secret'), null)
        revocations.push(form.get('token'))
        operations.push('revoke')
        if (options.interruptCleanup && revocations.length === 2) child.kill('SIGINT')
        if (options.hangCleanup && revocations.length > 1) { res.writeHead(200); res.flushHeaders(); return }
        reply(options.failCleanup && revocations.length > 1 ? 503 : 200, {})
      } else {
        issues.push(`unexpected endpoint ${url.pathname}`)
        reply(500, {})
      }
    } catch (error) {
      issues.push(error.message)
      res.writeHead(500); res.end('{}')
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const origin = `http://127.0.0.1:${server.address().port}`
  const child = fork(script, ['--client-id', clientId], {
    execArgv: ['--import', fileURLToPath(new URL('./test-support/runtime-probe.mjs', import.meta.url))],
    env: { ...process.env, WEEKLID_OAUTH_SPIKE_TEST_ORIGIN: origin, ...(options.consentTimeout ? { WEEKLID_SPIKE_TEST_EXPIRE_CONSENT: '1' } : {}) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  })
  let stdout = '', stderr = '', pending = ''
  const runtimeChecks = [], callbacks = []
  child.on('message', message => runtimeChecks.push(message.runtimeClean))
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdout.on('data', chunk => {
    stdout += chunk; pending += chunk
    const lines = pending.split('\n'); pending = lines.pop()
    for (const line of lines) {
      if (line.startsWith(origin + '/auth?')) {
        if (options.interruptAt === authorizations.length + 1) { child.kill('SIGINT'); continue }
        if (options.consentTimeout) continue
        const task = (async () => {
          const authorization = await fetch(line, { redirect: 'manual' })
          const callback = new URL(authorization.headers.get('location'))
          assert.equal(callback.origin + callback.pathname, 'http://localhost:8788/api/google/callback')
          // Exercise the registered localhost URI and each of its loopback resolutions.
          for (const host of ['localhost', '127.0.0.1', '[::1]']) {
            const probe = new URL(callback)
            probe.hostname = host
            probe.pathname = '/not-the-callback'
            assert.equal((await fetch(probe)).status, 404)
          }
          const response = await fetch(callback)
          const badState = options.badState === true || options.badState === authorizations.length
          assert.equal(await response.text(), badState ? 'no' : 'You can close this tab')
          assert.equal(response.status, badState ? 400 : 200)
        })().catch(error => issues.push(error.message))
        callbacks.push(task)
      }
    }
  })
  const timeout = setTimeout(() => child.kill('SIGKILL'), options.hangCleanup ? 40000 : 15000)
  try {
    const [exitCode, signal] = await once(child, 'close')
    await Promise.all(callbacks)
    assert.equal(signal, null)
    assert.deepEqual(issues, [])
    assert.equal(stdout.trimEnd().split('\n').at(-1), finalLine, 'the actual CLI must run')
    return { stdout, stderr, exitCode, operations, authorizations, exchanges, refreshes, revocations, events, tokens, privateValues, runtimeChecks, spawnargs: child.spawnargs }
  } finally {
    clearTimeout(timeout)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
}

test('matrix uses seven fresh authorizations, S256, offline consent and the specified exchanges', async () => {
  const result = await runFake()
  assert.equal(result.exitCode, 0)
  assert.equal(result.authorizations.length, 7)
  assert.match(result.stdout.split('\n')[0], /^Preconditions.*Calendar API enabled; owner is a test user; http:\/\/localhost:8788\/api\/google\/callback registered\.$/)
  for (const key of ['state', 'code_challenge']) assert.equal(new Set(result.authorizations.map(url => url.searchParams.get(key))).size, 7)
  for (const url of result.authorizations) {
    assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8788/api/google/callback')
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
    assert.equal(url.searchParams.get('access_type'), 'offline')
    assert.equal(url.searchParams.get('prompt'), 'consent')
    assert.equal(url.searchParams.get('scope'), scope)
    assert.equal(url.searchParams.get('response_type'), 'code')
    assert.equal(url.searchParams.get('client_id'), clientId)
  }
  assert.equal(result.exchanges.length, 7)
  assert.deepEqual(result.stdout.split('\n').filter(line => /^P\S+ exchange /.test(line)).map(line => line.split(' ')[0]), ['P1', 'P2a', 'P2b', 'P2c', 'P1′', 'P3', 'P4'])
  assert.deepEqual(result.operations, [
    ...Array(6).fill(['consent', 'exchange']).flat(), 'refresh', 'events',
    'consent', 'exchange', 'revoke', 'refresh', ...Array(4).fill('revoke'),
  ])
  assert.ok(result.exchanges[1].get('code_verifier'))
  assert.equal(result.exchanges[2].has('code_verifier'), false)
  assert.equal(result.exchanges[3].has('client_secret'), false)
  for (const [label, status] of [['P1', 200], ['P2a', 400], ['P2b', 400], ['P2c', 401], ['P1′', 200]]) {
    assert.match(result.stdout, new RegExp(`${label} exchange (?:yes|no) ${status}`))
  }
  assert.match(result.stdout, /P2a rejected yes 400/)
  assert.match(result.stdout, /P2b rejected yes 400/)
  assert.match(result.stdout, /P2c rejected yes 401/)
  assert.deepEqual(result.refreshes.map(form => form.get('refresh_token')), ['private-refresh-1', 'private-refresh-5'])
  assert.equal(result.events.length, 1)
  assert.equal(result.events[0].url.search, '?maxResults=1')
  assert.equal(result.events[0].authorization, 'Bearer private-refreshed-access-1')
  assert.match(result.stdout, /P3 expiry yes 200/)
  assert.match(result.stdout, /P4 other-refresh-survives no 400/)
  assert.match(result.stdout, /P4 invalid-grant yes 400/)
  await assert.rejects(fetch('http://localhost:8788/api/google/callback'))
})

test('stdout and stderr never expose secret, codes, tokens, errors, emails or event data', async () => {
  const result = await runFake()
  for (const value of [...result.privateValues, 'private-error-description', 'private-event-data', 'private@example.test']) {
    assert.ok(!(result.stdout + result.stderr).includes(value), `output leaked ${value}`)
  }
  assert.equal(result.stdout.trimEnd().split('\n').at(-1), finalLine)
})

test('secret never enters the actual process argv or environment', async () => {
  const result = await runFake()
  assert.ok(result.runtimeChecks.length >= 6)
  assert.ok(result.runtimeChecks.every(Boolean))
  assert.ok(!result.spawnargs.join(' ').includes(syntheticSecret))
})

test('state mismatch rejects callback before any code exchange and closes listener', async () => {
  const result = await runFake({ badState: true })
  assert.equal(result.exitCode, 2)
  assert.equal(result.exchanges.length, 0)
  assert.match(result.stdout, /callback stateMismatch no 400/)
  assert.ok(result.stdout.trimEnd().endsWith(finalLine))
  await assert.rejects(fetch('http://localhost:8788/api/google/callback'))
})

test('every obtained token has its own cleanup status including unexpected PKCE success', async () => {
  const result = await runFake({ acceptBadPkce: true, acceptNegativeTokens: true })
  const cleanup = result.stdout.split('\n').filter(line => line.startsWith('cleanup '))
  assert.equal(cleanup.length, result.tokens.size)
  assert.ok(cleanup.length > 4)
  for (const token of result.tokens) assert.ok(result.revocations.includes(token))
  for (const line of cleanup) assert.match(line, /^cleanup \d+ ok 200$/)
  assert.match(result.stdout, /P2a rejected no 200/)
  assert.match(result.stdout, /P2b rejected no 200/)
  for (const label of ['P2a', 'P2b', 'P2c']) assert.match(result.stdout, new RegExp(`${label} unexpected-token yes 200`))
})

test('cleanup HTTP failure is reported per token without claiming success', async () => {
  const result = await runFake({ failCleanup: true })
  assert.equal(result.exitCode, 0)
  assert.equal(result.authorizations.length, 7)
  assert.equal(result.tokens.size, 4, 'the failure path must actually obtain tokens')
  assert.deepEqual(result.revocations.slice(1), [...result.tokens])
  assert.deepEqual(result.stdout.split('\n').filter(line => line.startsWith('cleanup ')), [
    'cleanup 1 failed 503', 'cleanup 2 failed 503', 'cleanup 3 failed 503', 'cleanup 4 failed 503',
  ])
  // This same regression must also reject an `ok` claim after a timeout.
  await checkCleanupFailures()
})

test('cleanup hangs are bounded to five seconds per token and reported unknown', { timeout: 30000 }, async () => {
  const started = Date.now()
  const result = await runFake({ hangCleanup: true })
  assert.equal(result.exitCode, 0)
  assert.equal(result.tokens.size, 4)
  assert.deepEqual(result.revocations.slice(1), [...result.tokens])
  assert.deepEqual(result.stdout.split('\n').filter(line => line.startsWith('cleanup ')), [
    'cleanup 1 unknown 0', 'cleanup 2 unknown 0', 'cleanup 3 unknown 0', 'cleanup 4 unknown 0',
  ])
  assert.ok(Date.now() - started < result.tokens.size * 5000 + 4000)
})

test('P1 without refresh token stops before the next consent', async () => {
  const result = await runFake({ noRefresh: true })
  assert.equal(result.exitCode, 2)
  assert.equal(result.authorizations.length, 1)
  assert.match(result.stdout, /P1 refresh-token no 200/)
})

test('token redirects are refused rather than forwarding the secret', async () => {
  const result = await runFake({ redirectToken: true })
  assert.equal(result.exitCode, 2)
  assert.equal(result.exchanges.length, 1)
  assert.match(result.stdout, /P1 exchange no 0/)
})

test('P4 can record a surviving second refresh token', async () => {
  const result = await runFake({ survives: true })
  assert.match(result.stdout, /P4 other-refresh-survives yes 200/)
  assert.match(result.stdout, /P4 invalid-grant no 200/)
})

async function unitModule() { return import(pathToFileURL(script)) }
class FakeTTY extends EventEmitter {
  isTTY = true
  isRaw = false
  calls = []
  setRawMode(value) { this.calls.push(value); this.isRaw = value }
  resume() {}
  pause() {}
}

test('SIGINT and SIGTERM restore echo immediately and reject hidden input', async () => {
  const { createSecretPrompt, installSignalHandlers } = await unitModule()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    const tty = new FakeTTY(), signals = new EventEmitter(), controller = new AbortController()
    const prompt = createSecretPrompt(tty, () => {}, controller.signal, () => signals.emit('SIGINT'))
    const uninstall = installSignalHandlers(signals, controller, prompt.restore)
    const read = prompt.read()
    read.catch(() => {})
    assert.equal(tty.isRaw, true)
    signals.emit(signal)
    assert.equal(tty.isRaw, false)
    assert.deepEqual(tty.calls, [true, false])
    await assert.rejects(read)
    uninstall()
    assert.equal(signals.listenerCount(signal), 0)
  }
})

test('hidden TTY input is read once, restores echo on success and handles raw Ctrl-C', async () => {
  const { createSecretPrompt } = await unitModule()
  const tty = new FakeTTY(), controller = new AbortController()
  let output = ''
  const prompt = createSecretPrompt(tty, text => { output += text }, controller.signal, () => controller.abort())
  const read = prompt.read()
  tty.emit('data', Buffer.from('synthetic-typo\u007f\u007fsecret\r'))
  assert.equal(await read, 'synthetic-tysecret')
  assert.deepEqual(tty.calls, [true, false])
  assert.equal(tty.listenerCount('data'), 0)
  assert.ok(!output.includes('synthetic'))
  await assert.rejects(prompt.read())
  const tty2 = new FakeTTY(), controller2 = new AbortController()
  const prompt2 = createSecretPrompt(tty2, () => {}, controller2.signal, () => controller2.abort())
  const read2 = prompt2.read()
  tty2.emit('data', Buffer.from([3]))
  await assert.rejects(read2)
  assert.equal(tty2.isRaw, false)
  for (const failure of ['end', 'error']) {
    const failingTTY = new FakeTTY()
    const failingPrompt = createSecretPrompt(failingTTY, () => {}, new AbortController().signal, () => {})
    const rejected = failingPrompt.read()
    failingTTY.emit(failure, new Error('synthetic input failure'))
    await assert.rejects(rejected)
    assert.equal(failingTTY.isRaw, false)
    assert.deepEqual(failingTTY.calls, [true, false])
  }
})

test('test endpoint hook refuses TTY secrets even when its value is invalid', { timeout: 1000 }, async () => {
  const { createSecretPrompt } = await unitModule()
  const previous = process.env.WEEKLID_OAUTH_SPIKE_TEST_ORIGIN
  process.env.WEEKLID_OAUTH_SPIKE_TEST_ORIGIN = 'https://evil.test'
  const tty = new FakeTTY()
  try {
    const prompt = createSecretPrompt(tty, () => {}, new AbortController().signal, () => {})
    await assert.rejects(prompt.read())
    assert.deepEqual(tty.calls, [])
  } finally {
    if (previous === undefined) delete process.env.WEEKLID_OAUTH_SPIKE_TEST_ORIGIN
    else process.env.WEEKLID_OAUTH_SPIKE_TEST_ORIGIN = previous
  }
})

test('invalid client IDs and extra CLI arguments are rejected without network or TTY input', async () => {
  const { parseClientId } = await unitModule()
  assert.equal(parseClientId(['--client-id', clientId]), clientId)
  for (const args of [[], ['--client-id', 'bad'], ['--client-id', 'x.apps.googleusercontent.com.evil.test'], ['--client-id', clientId, 'secret'], ['--client-id', 'https://x.apps.googleusercontent.com']]) {
    assert.throws(() => parseClientId(args))
    const child = fork(script, args, { execArgv: [], stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
    let output = ''
    child.stdout.on('data', chunk => { output += chunk })
    child.stderr.on('data', chunk => { output += chunk })
    const [code] = await once(child, 'close')
    assert.equal(code, 2)
    assert.equal(output.trimEnd().split('\n').at(-1), finalLine)
    assert.ok(!output.includes('Client secret'))
  }
})

// Unit checks supplement the real CLI/listener checks when listen() is sandboxed.
async function withFetch(fake, action) {
  const original = globalThis.fetch
  globalThis.fetch = fake
  try { return await action() } finally { globalThis.fetch = original }
}

async function checkCleanupFailures() {
  const { cleanupTokens } = await unitModule()
  for (const failure of ['http', 'timeout', 'body-timeout']) {
    const rows = [], attempted = [], deadlines = []
    const originalTimeout = AbortSignal.timeout
    AbortSignal.timeout = milliseconds => { deadlines.push(milliseconds); return originalTimeout(milliseconds) }
    try {
      await withFetch(async (url, options) => {
        assert.equal(String(url), 'https://oauth2.googleapis.com/revoke')
        assert.equal(options.method, 'POST')
        assert.equal(options.redirect, 'error')
        attempted.push(options.body.get('token'))
        if (failure === 'body-timeout') return { status: 200, json: async () => { throw new DOMException('private timeout detail', 'TimeoutError') } }
        if (failure === 'timeout') throw new DOMException('private timeout detail', 'TimeoutError')
        return new Response('{}', { status: 503 })
      }, () => cleanupTokens(new Set(['first-synthetic-token', 'second-synthetic-token']), { revoke: 'https://oauth2.googleapis.com/revoke' }, row => rows.push(row)))
    } finally { AbortSignal.timeout = originalTimeout }
    assert.deepEqual(attempted, ['first-synthetic-token', 'second-synthetic-token'])
    assert.deepEqual(deadlines, [5000, 5000])
    assert.deepEqual(rows, failure === 'http'
      ? ['cleanup 1 failed 503', 'cleanup 2 failed 503']
      : ['cleanup 1 unknown 0', 'cleanup 2 unknown 0'])
  }
}

test('unit cleanup reports each HTTP failure and timeout without success or missing rows', checkCleanupFailures)

test('unit provider answers retain only needed transient fields and whitelisted error codes', async () => {
  const { request } = await unitModule()
  for (const error of ['invalid_grant', 'a'.repeat(40), 'private@example.test', 'UPPERCASE', 'bad\ncode', 'invalid_grant\n', 'invalid_grant\r', '', 'a'.repeat(41), 123, null]) {
    const result = await withFetch(async () => new Response(JSON.stringify({
      error, error_description: 'private-description', unexpected: 'private-data',
      items: [{ summary: 'private-event' }], refresh_token: 'synthetic-refresh',
      access_token: 'synthetic-access', scope, expires_in: 3600,
    }), { status: 400 }), () => request('https://oauth2.googleapis.com/token', { client_secret: syntheticSecret }))
    assert.deepEqual(result, {
      status: 400, error: ['invalid_grant', 'a'.repeat(40)].includes(error) ? error : undefined,
      refreshToken: 'synthetic-refresh', accessToken: 'synthetic-access', hasScope: true, expiryNearHour: true,
    })
  }
})

test('unit consent binds both loopbacks, keeps the registered URI and has a five minute deadline', async () => {
  const { consent } = await unitModule()
  const authorizationUrls = []
  for (const mode of [...Array(7).fill('callback'), 'timeout', 'abort', 'bind-failure']) {
    const controller = new AbortController(), deadline = new AbortController()
    const listeners = [], durations = [], rows = []
    const originalTimeout = AbortSignal.timeout
    AbortSignal.timeout = milliseconds => { durations.push(milliseconds); return deadline.signal }
    const createListener = handler => {
      const listener = new EventEmitter()
      listener.handler = handler
      listener.listen = (options, ready) => {
        listener.options = options
        if (mode === 'bind-failure' && options.host === '::1') queueMicrotask(() => listener.emit('error', new Error('synthetic bind failure')))
        else queueMicrotask(ready)
      }
      listener.closeAllConnections = () => { listener.connectionsClosed = true }
      listener.close = done => { listener.closed = true; done() }
      listeners.push(listener)
      return listener
    }
    try {
      const result = consent(clientId, { authorization: 'https://accounts.google.com/o/oauth2/v2/auth' }, controller.signal, row => {
        rows.push(row)
        const url = new URL(row)
        authorizationUrls.push(url)
        assert.equal(url.searchParams.get('code_challenge_method'), 'S256')
        assert.equal(url.searchParams.get('access_type'), 'offline')
        assert.equal(url.searchParams.get('prompt'), 'consent')
        assert.equal(url.searchParams.get('redirect_uri'), 'http://localhost:8788/api/google/callback')
        if (mode === 'timeout') { deadline.abort(); return }
        if (mode === 'abort') { controller.abort(); return }
        const callback = new URL(url.searchParams.get('redirect_uri'))
        callback.searchParams.set('state', url.searchParams.get('state'))
        callback.searchParams.set('code', 'synthetic-code')
        const response = new EventEmitter()
        response.setHeader = () => {}
        response.writeHead = status => { response.status = status }
        response.end = body => {
          assert.equal(body, 'You can close this tab')
          assert.equal(response.status, 200)
          response.emit('finish')
        }
        listeners[1].handler({ method: 'GET', url: callback.pathname + callback.search }, response)
      }, createListener)
      if (mode === 'callback') {
        const value = await result
        assert.equal(value.code, 'synthetic-code')
        assert.equal(typeof value.verifier, 'string')
        assert.equal(createHash('sha256').update(value.verifier).digest('base64url'), authorizationUrls.at(-1).searchParams.get('code_challenge'))
      } else await assert.rejects(result)
      assert.deepEqual(durations, [300000])
      assert.deepEqual(listeners.map(listener => listener.options), [
        { port: 8788, host: '127.0.0.1' }, { port: 8788, host: '::1', ipv6Only: true },
      ])
      assert.ok(listeners.every(listener => listener.closed && listener.connectionsClosed))
      assert.equal(rows.length, mode === 'bind-failure' ? 0 : 1)
    } finally { AbortSignal.timeout = originalTimeout }
  }
  for (const key of ['state', 'code_challenge']) assert.equal(new Set(authorizationUrls.map(url => url.searchParams.get(key))).size, authorizationUrls.length)
})

test('unit runtime preconditions enforce engines and AbortSignal.any availability', async () => {
  const { assertRuntime } = await unitModule()
  for (const version of ['18.20.0', '19.9.0', '20.0.0', '20.2.0', '20.18.9', '21.7.0', '22.11.0']) {
    assert.throws(() => assertRuntime(version), /nodeVersion/, version)
  }
  for (const version of ['20.19.0', '20.20.0', '22.12.0', '22.13.0', '23.0.0', '26.0.0']) {
    assert.doesNotThrow(() => assertRuntime(version), version)
  }
  const originalAny = AbortSignal.any
  try {
    for (const unavailable of [undefined, null, {}]) {
      AbortSignal.any = unavailable
      assert.throws(() => assertRuntime('26.0.0'), /nodeVersion/)
    }
  } finally { AbortSignal.any = originalAny }
})

test('consent timeout exits 2 with a partial table and final reminder', async () => {
  const result = await runFake({ consentTimeout: true })
  assert.equal(result.exitCode, 2)
  assert.equal(result.exchanges.length, 0)
})

test('cleanup still runs after a later consent fails', async () => {
  const result = await runFake({ badState: 7 })
  assert.equal(result.exitCode, 2)
  assert.equal(result.tokens.size, 3)
  assert.deepEqual(result.revocations, [...result.tokens])
  assert.deepEqual(result.stdout.split('\n').filter(line => line.startsWith('cleanup ')), [
    'cleanup 1 ok 200', 'cleanup 2 ok 200', 'cleanup 3 ok 200',
  ])
})

test('an unexpected token on a rejected exchange is reported and revoked', async () => {
  const result = await runFake({ unexpectedFailureToken: true })
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /P2a unexpected-token yes 400/)
  assert.match(result.stdout, /P2a error invalid_grant 400/)
  assert.equal(result.tokens.size, 5)
  assert.deepEqual(result.revocations.slice(1), [...result.tokens])
})

test('unit matrix preserves case order, exact exchange URI, negative-token reporting and cleanup', async () => {
  const { run, cleanupTokens } = await unitModule()
  for (const mode of ['normal', 'unexpected', 'late-failure', 'network-timeout']) {
    const rows = [], requests = [], authorizations = [], tokens = new Set()
    const urls = { token: 'https://oauth2.googleapis.com/token', revoke: 'https://oauth2.googleapis.com/revoke', events: 'https://www.googleapis.com/calendar/v3/calendars/primary/events' }
    const authorize = async () => {
      if (mode === 'late-failure' && authorizations.length === 6) throw new Error('synthetic consent failure')
      const number = authorizations.length + 1
      const authorization = { code: `synthetic-code-${number}`, verifier: `synthetic-verifier-${number}` }
      authorizations.push(authorization)
      return authorization
    }
    await withFetch(async (url, options) => {
      const form = options.body
      requests.push({ url: String(url), form, authorization: options.headers?.Authorization })
      assert.ok(!String(url).includes(syntheticSecret))
      assert.equal(options.redirect, 'error')
      if (String(url) === urls.token && form.get('grant_type') === 'authorization_code') {
        const number = Number(form.get('code').split('-').at(-1))
        assert.equal(form.get('redirect_uri'), 'http://localhost:8788/api/google/callback')
        assert.equal(form.get('client_id'), clientId)
        assert.ok(form instanceof URLSearchParams)
        if (number === 2) assert.notEqual(form.get('code_verifier'), authorizations[1].verifier)
        else if (number === 3) assert.equal(form.has('code_verifier'), false)
        else assert.equal(form.get('code_verifier'), authorizations[number - 1].verifier)
        if (number === 4) assert.equal(form.has('client_secret'), false)
        else assert.equal(form.get('client_secret'), syntheticSecret)
        if (number === 2 && mode === 'network-timeout') throw new DOMException('private timeout', 'TimeoutError')
        const negative = number >= 2 && number <= 4
        const error = number === 4 ? 'invalid_client' : 'invalid_grant'
        return new Response(JSON.stringify({
          ...(negative ? { error, error_description: 'private-description' } : {}),
          ...(!negative || mode === 'unexpected' ? { refresh_token: `synthetic-token-${number}`, scope } : {}),
        }), { status: negative ? number === 4 ? 401 : 400 : 200 })
      }
      if (String(url) === urls.token) {
        const p4 = requests.some(request => request.url === urls.revoke)
        assert.equal(form.get('refresh_token'), p4 ? 'synthetic-token-5' : 'synthetic-token-1')
        return new Response(JSON.stringify(p4 ? { error: 'invalid_grant' } : { access_token: 'synthetic-access', expires_in: 3600 }), { status: p4 ? 400 : 200 })
      }
      if (String(url).startsWith(urls.events)) {
        assert.equal(String(url), urls.events + '?maxResults=1')
        assert.equal(options.headers.Authorization, 'Bearer synthetic-access')
      }
      return new Response('{}', { status: 200 })
    }, async () => {
      const result = run(clientId, syntheticSecret, urls, new AbortController().signal, row => rows.push(row), tokens, authorize)
      try {
        if (['late-failure', 'network-timeout'].includes(mode)) await assert.rejects(result)
        else await result
      } finally { await cleanupTokens(tokens, urls, row => rows.push(row)) }
    })
    const expectedLabels = mode === 'network-timeout' ? ['P1', 'P2a'] : mode === 'late-failure' ? ['P1', 'P2a', 'P2b', 'P2c', 'P1′', 'P3'] : ['P1', 'P2a', 'P2b', 'P2c', 'P1′', 'P3', 'P4']
    assert.deepEqual(rows.filter(row => / exchange /.test(row)).map(row => row.split(' ')[0]), expectedLabels)
    const expectedTokens = mode === 'network-timeout' ? [1] : mode === 'late-failure' ? [1, 5, 6] : mode === 'unexpected' ? [1, 2, 3, 4, 5, 6, 7] : [1, 5, 6, 7]
    assert.deepEqual([...tokens], expectedTokens.map(number => `synthetic-token-${number}`))
    assert.deepEqual(requests.slice(-tokens.size).map(request => request.form.get('token')), [...tokens])
    assert.deepEqual(rows.slice(-tokens.size), expectedTokens.map((_, index) => `cleanup ${index + 1} ok 200`))
    if (mode === 'unexpected') for (const [label, status] of [['P2a', 400], ['P2b', 400], ['P2c', 401]]) {
      assert.ok(rows.includes(`${label} unexpected-token yes ${status}`))
      assert.ok(rows.includes(`${label} error ${label === 'P2c' ? 'invalid_client' : 'invalid_grant'} ${status}`))
    }
    assert.ok(!rows.join('\n').includes('synthetic-token'))
    assert.ok(!rows.join('\n').includes(syntheticSecret))
    assert.ok(!rows.join('\n').includes('private-description'))
  }
})

test('SIGINT during consent exits 130 and cleans previously obtained tokens', async () => {
  const result = await runFake({ interruptAt: 7 })
  assert.equal(result.exitCode, 130)
  assert.equal(result.tokens.size, 3)
  assert.deepEqual(result.revocations, [...result.tokens])
  assert.equal(result.stdout.split('\n').filter(line => /^cleanup \d+ ok 200$/.test(line)).length, 3)
})


test('SIGINT during cleanup exits 130 without cancelling remaining revocations', async () => {
  const result = await runFake({ interruptCleanup: true })
  assert.equal(result.exitCode, 130)
  assert.equal(result.tokens.size, 4)
  assert.deepEqual(result.revocations.slice(1), [...result.tokens])
  assert.deepEqual(result.stdout.split('\n').filter(line => line.startsWith('cleanup ')), [
    'cleanup 1 ok 200', 'cleanup 2 ok 200', 'cleanup 3 ok 200', 'cleanup 4 ok 200',
  ])
})
