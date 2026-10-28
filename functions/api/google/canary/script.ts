// The canary page's only script (no inline code under its CSP). Start, Mint and Disconnect each run under the
// `weeklid-google` lock contract of design D15: exclusive, acquisition bounded at 20 s, the task at 15 s, no steal,
// no nesting, no unlocked fallback, and the lock released before navigating to Google.
import { deps, type PagesContext } from '../../../../server/google/deps'
import { servePage } from '../../../../server/google/http'

const SCRIPT = `(() => {
  'use strict'
  const output = document.getElementById('result')
  const show = (text) => { output.textContent = text }
  const RESULTS = ['canary', 'connected', 'cancelled', 'state', 'denied', 'auth', 'exchange', 'noRefreshToken',
    'missingScope', 'storage', 'disabled', 'notConfigured', 'error']
  let held = 0

  // Resolves { value } or { error } from the task, or { lock: 'unavailable' | 'busy' | 'nested' } without running it.
  async function runLocked(task) {
    const locks = navigator.locks
    if (!locks || typeof locks.request !== 'function') return { lock: 'unavailable' }
    if (held > 0) return { lock: 'nested' }
    held++
    try {
      return await locks.request('weeklid-google', { mode: 'exclusive', signal: AbortSignal.timeout(20000) }, async () => {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 15000)
        try {
          return { value: await task(controller.signal) }
        } catch (error) {
          return { error: (error && error.name) || 'Error' }
        } finally {
          clearTimeout(timer)
        }
      })
    } catch (error) {
      return { lock: error && error.name === 'TimeoutError' ? 'busy' : 'unavailable' }
    } finally {
      held--
    }
  }

  async function post(path, body, signal) {
    const headers = { 'X-Weeklid': '1' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const response = await fetch(path, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store', headers, signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    let data = null
    try { data = await response.json() } catch (error) { data = null }
    return { status: response.status, data }
  }

  const codeOf = (reply) => reply.status === 200 ? 'ok'
    : (reply.data && typeof reply.data.code === 'string' ? reply.data.code : 'http' + reply.status)
  const describe = (run) => run.lock ? 'lock ' + run.lock : run.error ? 'network ' + run.error : null

  function freshEpoch() {
    const bytes = crypto.getRandomValues(new Uint8Array(16))
    return btoa(String.fromCharCode(...bytes)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '')
  }

  document.getElementById('start').addEventListener('click', async () => {
    show('starting')
    const run = await runLocked((signal) => post('/api/google/connect', { from: 'canary', epoch: freshEpoch() }, signal))
    const failure = describe(run)
    if (failure) return show(failure)
    const reply = run.value
    if (reply.status === 200 && reply.data && typeof reply.data.url === 'string') location.assign(reply.data.url)
    else show(codeOf(reply))
  })

  document.getElementById('mint').addEventListener('click', async () => {
    const codes = []
    for (let i = 0; i < 3; i++) {
      const run = await runLocked((signal) => post('/api/google/token', undefined, signal))
      codes.push(describe(run) || codeOf(run.value))
      show(codes.join(' '))
    }
  })

  document.getElementById('disconnect').addEventListener('click', async () => {
    show('disconnecting')
    const run = await runLocked(async (signal) => {
      const status = await post('/api/google/status', undefined, signal)
      if (status.status !== 200 || !status.data || typeof status.data.gen !== 'string') return codeOf(status)
      const reply = await post('/api/google/disconnect', { revoke: true, gen: status.data.gen }, signal)
      return reply.status === 200 && reply.data ? String(reply.data.result) : codeOf(reply)
    })
    show(describe(run) || run.value)
  })

  const returned = new URLSearchParams(location.search).get('google')
  if (returned !== null) {
    const result = RESULTS.includes(returned) ? returned : 'unknown'
    show(result)
    if (result === 'canary') {
      runLocked((signal) => post('/api/google/token', undefined, signal)).then((run) => {
        const code = describe(run) || codeOf(run.value)
        show(code === 'notConnected' ? 'PASS: canary, then notConnected' : 'FAIL: canary, then ' + code)
      })
    }
  }
})()
`

export const onRequestGet = (ctx: PagesContext): Promise<Response> =>
  servePage(deps(ctx.env), 'canaryScript', ctx.request, 'text/javascript; charset=utf-8', SCRIPT)
