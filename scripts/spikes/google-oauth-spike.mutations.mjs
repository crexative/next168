import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('.', import.meta.url))
const source = await readFile(join(directory, 'google-oauth-spike.mjs'), 'utf8')
const tests = join(directory, 'google-oauth-spike.test.mjs')
const unitOnly = process.argv.includes('--unit-only')
const unitPattern = '^unit |SIGINT and|hidden TTY|test endpoint|invalid client'
// Each replacement must change exactly one known site; no infrastructure failure counts as a kill.
const mutants = [
  ['signal echo restore', '^SIGINT and', 'try { restore() } finally', 'try { /* removed */ } finally', true],
  ['finally echo restore', 'hidden TTY', '        restore()\n        detach()', '        /* removed */\n        detach()', true],
  ['test hook TTY refusal', 'test endpoint', 'used || testMode() ||', 'used || false ||', true],
  ['extra argument refusal', 'invalid client', 'args.length !== 2 ||', 'false ||', true],
  ['fresh state', '^matrix', 'const state = randomValue(), verifier', "const state = 'fixed-state', verifier", '^unit consent'],
  ['fresh verifier', '^matrix', 'verifier = randomValue()', "verifier = 'fixed-verifier'", '^unit consent'],
  ['PKCE S256', '^matrix', "code_challenge_method: 'S256'", "code_challenge_method: 'plain'", '^unit consent'],
  ['offline consent', '^matrix', "access_type: 'offline'", "access_type: 'online'", '^unit consent'],
  ['P2a wrong verifier', '^matrix', "mode === 'wrong' ? randomValue() : verifier", 'verifier', '^unit matrix'],
  ['P2b omitted verifier', '^matrix', "mode === 'omitted' ? {}", 'false ? {}', '^unit matrix'],
  ['P2c omitted secret', '^matrix', "mode === 'no-secret' ? {}", 'false ? {}', '^unit matrix'],
  ['P3 refresh RT1', '^matrix', 'const p3 = await refresh(rt1)', 'const p3 = await refresh(rt2)', '^unit matrix'],
  ['P4 refresh RT2', '^matrix', 'const p4 = await refresh(rt2)', 'const p4 = await refresh(rt1)', '^unit matrix'],
  ['secret output', '^stdout', 'await run(clientId, secret, urls', 'print(secret)\n    await run(clientId, secret, urls'],
  ['code output', '^stdout', 'const { code, verifier } = await authorize(clientId, urls, signal, print)', 'const { code, verifier } = await authorize(clientId, urls, signal, print)\n    print(code)'],
  ['token output', '^stdout', 'const token = result.refreshToken', 'const token = result.refreshToken\n    if (token) print(token)'],
  ['secret in argv', '^secret never', 'await run(clientId, secret, urls', 'process.argv.push(secret)\n    await run(clientId, secret, urls'],
  ['secret in env', '^secret never', 'await run(clientId, secret, urls', 'process.env.SPIKE_LEAK = secret\n    await run(clientId, secret, urls'],
  ['state check', '^state mismatch', 'const validState = returnedState.length === expectedState.length && timingSafeEqual(returnedState, expectedState)', 'const validState = true'],
  ['cleanup coverage', '^every obtained', 'for (const token of tokens)', 'for (const token of [])', '^unit cleanup'],
  ['cleanup failure honesty', '^cleanup HTTP', "result.status === 0 ? 'unknown' : 'failed'", "result.status === 0 ? 'unknown' : 'ok'", '^unit cleanup'],
  ['cleanup timeout', '^cleanup hangs', 'await request(urls.revoke, { token }, undefined, 5000)', 'await request(urls.revoke, { token }, undefined, 15000)', '^unit cleanup'],
  ['P1 missing refresh stop', '^P1 without', "if (result.status !== 200 || !hasRefresh || !hasScope) throw new Error('redesign required')", "if (result.status !== 200 || !hasScope) throw new Error('redesign required')"],
  ['secret redirect refusal', '^token redirects', "redirect: 'error'", "redirect: 'follow'"],
  ['P4 surviving token report', '^P4 can', "report('P4 other-refresh-survives', p4.status === 200 && typeof p4.accessToken === 'string', p4.status)", "report('P4 other-refresh-survives', false, p4.status)"],

  ['cleanup timeout honesty', '^cleanup HTTP', "result.status === 0 ? 'unknown' : 'failed'", "result.status === 0 ? 'ok' : 'failed'", '^unit cleanup'],
  ['cleanup report missing token', '^cleanup HTTP', 'print(`cleanup ${++number} ${status} ${result.status}`)', 'if (++number > 1) print(`cleanup ${number} ${status} ${result.status}`)', '^unit cleanup'],
  ['cleanup omits last token', '^cleanup HTTP', 'for (const token of tokens)', 'for (const token of [...tokens].slice(0, -1))', '^unit cleanup'],
  ['case order', '^matrix', "[['P2a', 'wrong'], ['P2b', 'omitted'], ['P2c', 'no-secret']]", "[['P2b', 'omitted'], ['P2a', 'wrong'], ['P2c', 'no-secret']]", '^unit matrix'],
  ['consent deadline too short', '^consent timeout', 'AbortSignal.timeout(5 * 60 * 1000)', 'AbortSignal.timeout(30 * 1000)', '^unit consent'],
  ['consent deadline too long', '^consent timeout', 'AbortSignal.timeout(5 * 60 * 1000)', 'AbortSignal.timeout(10 * 60 * 1000)', '^unit consent'],
  ['listener IPv4 wildcard', '^matrix', "{ port: 8788, host: '127.0.0.1' }", "{ port: 8788, host: '0.0.0.0' }", '^unit consent'],
  ['listener IPv6 missing', '^matrix', ", { port: 8788, host: '::1', ipv6Only: true }", '', '^unit consent'],
  ['authorization redirect URI', '^matrix', 'client_id: clientId, redirect_uri: redirectUri, response_type:', "client_id: clientId, redirect_uri: 'http://127.0.0.1:8788/api/google/callback', response_type:", '^unit consent'],
  ['exchange redirect URI', '^matrix', 'code, redirect_uri: redirectUri,', "code, redirect_uri: 'http://127.0.0.1:8788/api/google/callback',", '^unit matrix'],
  ['provider error whitelist', '^stdout', "typeof data?.error === 'string' && /^[a-z_]{1,40}$/.test(data.error) ? data.error : undefined", 'data?.error', '^unit provider'],
  ['raw provider answer retained', '^stdout', 'status: response.status,', 'status: response.status, data,', '^unit provider'],
  ['unexpected token not reported', '^an unexpected', "if (mode !== 'correct' && token) report", 'if (false) report', '^unit matrix'],
  ['unexpected token not remembered', '^an unexpected', 'const token = remember(result)', "const token = mode === 'correct' ? remember(result) : result.refreshToken", '^unit matrix'],
  ['form encoding', '^matrix', 'body: new URLSearchParams(body)', 'body: JSON.stringify(body)', '^unit matrix'],
  ['completed table exit code', '^matrix', '    await run(clientId, secret, urls, controller.signal, print, tokens)', '    await run(clientId, secret, urls, controller.signal, print, tokens)\n    process.exitCode = 2'],
  ['precondition exit code', '^invalid client', 'process.exitCode = 2', 'process.exitCode = 1', true],
  ['SIGINT exit code', '^SIGINT during consent', 'if (controller.signal.aborted) process.exitCode = 130', 'if (controller.signal.aborted) process.exitCode = 143'],
  ['Node precondition', '^unit runtime', "Number(version.split('.')[0]) < 20", 'false', true],
  ['startup preconditions printed', '^matrix', "    print('Preconditions (verify in Google Console): Calendar API enabled; owner is a test user; http://localhost:8788/api/google/callback registered.')", '    /* omitted */'],
  ['cleanup body timeout honesty', '^cleanup HTTP', "      if (error?.name === 'AbortError' || error?.name === 'TimeoutError') throw error", '      /* ignored body timeout */', '^unit cleanup'],
  ['cleanup interruption exit', '^SIGINT during cleanup', '      if (controller.signal.aborted) process.exitCode = 130', '      /* omitted */'],
  ['network timeout abort', '^token redirects', "    if (result.status === 0) throw new Error('requestUnavailable')", '    /* omitted */', '^unit matrix'],
]
// Validate the entire catalog even when only sandbox-safe checks will execute.
for (const [name, , before] of mutants) assert.equal(source.split(before).length - 1, 1, `ambiguous mutation: ${name}`)
const execute = (pattern, script) => spawnSync(process.execPath, ['--test', ...(pattern ? [`--test-name-pattern=${pattern}`] : []), tests], {
  env: { ...process.env, ...(script ? { WEEKLID_SPIKE_TEST_SCRIPT: script } : {}) },
  encoding: 'utf8', timeout: 45000,
})
const baseline = execute(unitOnly ? unitPattern : undefined)
if (baseline.status !== 0) {
  process.stderr.write(baseline.stdout + baseline.stderr)
  throw new Error('Baseline failed; no mutation evidence can be claimed.')
}
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'weeklid-spike-mutants-')))
try {
  let killed = 0
  for (const [name, pattern, before, after, unit] of mutants) {
    const companion = typeof unit === 'string' ? unit : unit ? pattern : undefined
    if (unitOnly && !companion) continue
    const mutant = join(temporary, 'google-oauth-spike.mjs')
    await writeFile(mutant, source.replace(before, after))
    const result = execute(unitOnly ? companion : companion ? `(?:${pattern})|(?:${companion})` : pattern, mutant)
    if (result.error || result.signal || result.status === 0 || /listen EPERM|EADDRINUSE|ERR_MODULE_NOT_FOUND|SyntaxError/.test(result.stdout + result.stderr)) {
      throw new Error(`Mutation survived or was not discriminating: ${name}\n${result.stdout}${result.stderr}`)
    }
    killed++
    process.stdout.write(`KILLED: ${name} (test exit ${result.status})\n`)
  }
  process.stdout.write(`${killed} mutations killed; green baseline; temporary copies removed on exit.\n`)
} finally {
  await rm(temporary, { recursive: true, force: true })
}
