// @vitest-environment node
// S1 sign-in: state, PKCE and the single-use pending row; login CSRF; ID token checks; sessions; the invite-only beta.
import { describe, expect, it } from 'vitest'
import { IDENTITY_SCOPE } from './identity'
import { ALICE, APP, BOB, FAKE_ID, accountKeyOf, server } from './testing/harness'

const FLOW_COOKIE = '__Host-wl_aflow'
const SESSION_COOKIE = '__Host-wl_ses'

function invitedServer() {
  const s = server()
  s.invite(ALICE.email)
  s.invite(BOB.email)
  return s
}

describe('S1 the authorization request', () => {
  it('asks only for openid, email and profile, with PKCE S256, a state and a nonce, and never for offline access', async () => {
    const s = invitedServer()
    const { url, reply } = await s.browser().start()
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(url.searchParams.get('scope')).toBe(IDENTITY_SCOPE)
    expect(IDENTITY_SCOPE).toBe('openid email profile')
    expect(url.searchParams.get('response_type')).toBe('code')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(url.searchParams.get('client_id')).toBe(FAKE_ID.clientId)
    expect(url.searchParams.get('redirect_uri')).toBe(`${APP}/api/auth/callback`)
    expect(url.searchParams.has('access_type')).toBe(false)
    expect(url.toString()).not.toContain('calendar')
    const flow = reply.setCookies.find((cookie) => cookie.startsWith(`${FLOW_COOKIE}=`))!
    expect(flow).toMatch(/; Secure; HttpOnly; SameSite=Lax$/)
    expect(flow).toContain('Path=/')
    expect(flow).not.toContain('Domain')
    expect(flow.split(';')[0]!.split('=')[1]).not.toBe(url.searchParams.get('state'))
  })

  it('stores the pending row by hashes only, with the verifier sealed', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { url } = await b.start()
    const [row] = s.rows('auth_pending')
    expect(s.rows('auth_pending')).toHaveLength(1)
    expect(Object.keys(row!).sort()).toEqual(['consent_version', 'created_at', 'flow_hash', 'nonce', 'state_hash', 'verifier'])
    for (const plain of [url.searchParams.get('state')!, b.flow!]) expect(JSON.stringify(row)).not.toContain(plain)
    expect(String(row!.verifier)).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
  })

  it('refuses a start without the consent version, and a wrong one', async () => {
    const s = invitedServer()
    const b = s.browser()
    expect((await b.call('auth/start', {})).status).toBe(400)
    expect((await b.call('auth/start', { consent: 2 })).status).toBe(400)
    expect((await b.call('auth/start', { consent: 1, extra: true })).status).toBe(400)
    expect(s.rows('auth_pending')).toEqual([])
  })
})

describe('S1 state, PKCE and the single-use pending row', () => {
  it('signs in, and the code verifier the server sends is the preimage of the challenge it announced', async () => {
    const s = invitedServer()
    const b = s.browser()
    expect(await b.signIn(ALICE)).toBe('signedIn')
    expect(s.identity.calls).toHaveLength(1)
    const call = s.identity.calls[0]!
    expect(call.form.grant_type).toBe('authorization_code')
    expect(call.form.redirect_uri).toBe(`${APP}/api/auth/callback`)
    expect(b.session).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('a wrong PKCE verifier at Google ends in no session', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state, nonce } = await b.start()
    const code = s.identity.issueCode(ALICE, { challenge: 'not-the-challenge-of-this-flow', nonce })
    const { result } = await b.callback({ state, code })
    expect(result).toBe('exchange')
    expect(b.session).toBeUndefined()
    expect(s.rows('sessions')).toEqual([])
  })

  it('replaying the same callback creates no second session and no second exchange', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state, nonce, challenge } = await b.start()
    const code = s.identity.issueCode(ALICE, { challenge, nonce })
    const flow = b.flow!
    expect((await b.callback({ state, code })).result).toBe('signedIn')
    const sessionsBefore = s.rows('sessions')
    expect((await b.callback({ state, code }, { flow })).result).toBe('state')
    expect(s.rows('sessions')).toEqual(sessionsBefore)
    expect(s.identity.calls).toHaveLength(1)
    expect(s.rows('auth_pending')).toEqual([])
  })

  it('a missing flow cookie, a foreign one, or an unknown or altered state gives no session and never reaches Google', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state, nonce, challenge } = await b.start()
    const code = s.identity.issueCode(ALICE, { challenge, nonce })
    const flow = b.flow!
    const other = s.browser()
    await other.start()
    const altered = `${state.slice(0, -1)}${state.endsWith('A') ? 'B' : 'A'}`
    const attempts: { query: Record<string, string>; flow: string | null }[] = [
      { query: { state, code }, flow: null },
      { query: { state, code }, flow: other.flow! },
      { query: { state, code }, flow: 'x'.repeat(43) },
      { query: { state: altered, code }, flow: b.flow! },
      { query: { code }, flow: b.flow! },
      { query: { state: 'short', code }, flow: b.flow! },
    ]
    for (const attempt of attempts) {
      const { result } = await b.callback(attempt.query, { flow: attempt.flow })
      expect(result).toBe('state')
    }
    expect(s.identity.calls).toEqual([])
    expect(s.rows('sessions')).toEqual([])
    // None of those attempts consumed the genuine pending row: the real flow can still finish.
    expect((await b.callback({ state, code }, { flow })).result).toBe('signedIn')
  })

  it('an expired pending row gives no session', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state, nonce, challenge } = await b.start()
    const code = s.identity.issueCode(ALICE, { challenge, nonce })
    s.advance(601)
    expect((await b.callback({ state, code })).result).toBe('state')
    expect(s.identity.calls).toEqual([])
    expect(s.rows('sessions')).toEqual([])
  })

  it('a pending row still valid at its last second works', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state, nonce, challenge } = await b.start()
    const code = s.identity.issueCode(ALICE, { challenge, nonce })
    s.advance(600)
    expect((await b.callback({ state, code })).result).toBe('signedIn')
  })

  it('Google reporting an error consumes the pending row and signs nobody in', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state } = await b.start()
    expect((await b.callback({ state, error: 'access_denied' })).result).toBe('denied')
    expect(s.rows('auth_pending')).toEqual([])
    const again = await b.start()
    expect((await b.callback({ state: again.state, error: 'server_error' })).result).toBe('auth')
    expect(s.rows('sessions')).toEqual([])
  })
})

describe('S1 login CSRF: an attacker cannot sign a victim in as the attacker', () => {
  async function attackerFlow() {
    const s = invitedServer()
    const attacker = s.browser()
    const { state, nonce, challenge } = await attacker.start()
    const code = s.identity.issueCode(ALICE, { challenge, nonce })
    return { s, attacker, state, code }
  }

  it('the attacker\'s own state and code delivered to a victim without a flow cookie sign nobody in', async () => {
    const { s, attacker, state, code } = await attackerFlow()
    const victim = s.browser()
    const { result, reply } = await victim.callback({ state, code })
    expect(result).toBe('state')
    expect(victim.session).toBeUndefined()
    expect(reply.setCookies.some((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`) && !/Max-Age=0/.test(cookie))).toBe(false)
    expect(s.rows('sessions')).toEqual([])
    expect(s.identity.calls).toEqual([])
    expect((await victim.sessionStatus()).body).toEqual({ signedIn: false })
    // The attacker's own pending row is untouched, so the attacker alone can still complete their own sign-in.
    expect(s.rows('auth_pending')).toHaveLength(1)
    expect((await attacker.callback({ state, code })).result).toBe('signedIn')
  })

  it('with the victim\'s own flow cookie from a different sign-in start, it still signs nobody in', async () => {
    const { s, state, code } = await attackerFlow()
    const victim = s.browser()
    await victim.start()
    const { result } = await victim.callback({ state, code })
    expect(result).toBe('state')
    expect(victim.session).toBeUndefined()
    expect(s.rows('sessions')).toEqual([])
    expect(s.identity.calls).toEqual([])
    expect(s.rows('auth_pending')).toHaveLength(2)
  })

  it('a victim already signed in as someone else stays signed in as themselves', async () => {
    const { s, state, code } = await attackerFlow()
    const victim = s.browser()
    expect(await victim.signIn(BOB)).toBe('signedIn')
    const before = victim.session
    const { result } = await victim.callback({ state, code })
    expect(result).toBe('state')
    expect(victim.session).toBe(before)
    const status = (await victim.sessionStatus()).body!
    expect(status.email).toBe(BOB.email)
  })
})

describe('S1 the ID token', () => {
  async function signInWith(claims: Record<string, unknown>, who = ALICE) {
    const s = invitedServer()
    const b = s.browser()
    const { state, nonce, challenge } = await b.start()
    const code = s.identity.issueCode({ ...who, claims }, { challenge, nonce })
    return { s, b, result: (await b.callback({ state, code })).result }
  }

  it.each([
    ['a wrong issuer', { iss: 'https://evil.example.com' }],
    ['a wrong audience', { aud: '999999999999-other.apps.googleusercontent.com' }],
    ['an expired token', { exp: 1 }],
    ['a token without an expiry', { exp: undefined }],
    ['a wrong nonce', { nonce: 'another-nonce' }],
    ['a missing nonce', { nonce: undefined }],
    ['an unverified e-mail', { email_verified: false }],
    ['a missing subject', { sub: undefined }],
    ['an empty subject', { sub: '' }],
  ])('%s gives no session', async (_name, claims) => {
    const { s, b, result } = await signInWith(claims)
    expect(result).toBe('auth')
    expect(b.session).toBeUndefined()
    expect(s.rows('sessions')).toEqual([])
    expect(s.rows('accounts')).toEqual([])
  })

  it('accepts the bare issuer form Google also uses', async () => {
    expect((await signInWith({ iss: 'accounts.google.com' })).result).toBe('signedIn')
  })

  it('a token endpoint that fails or hangs gives no session and logs only an error class', async () => {
    const s = invitedServer()
    const b = s.browser()
    const first = await b.start()
    s.identity.script({ status: 500, body: { error: 'server_error' } })
    expect((await b.callback({ state: first.state, code: 'c' })).result).toBe('exchange')
    const second = await b.start()
    s.identity.script('hang')
    expect((await b.callback({ state: second.state, code: 'c' })).result).toBe('exchange')
    expect(s.rows('sessions')).toEqual([])
    expect(s.logs.some((line) => JSON.parse(line).e === 'TimeoutError' || JSON.parse(line).e === 'AbortError')).toBe(true)
  })

  it('a token response without an id_token gives no session', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state } = await b.start()
    s.identity.script({ status: 200, body: { access_token: 'at-SECRET-123' } })
    expect((await b.callback({ state, code: 'c' })).result).toBe('auth')
    expect(s.rows('sessions')).toEqual([])
  })
})

describe('S1 sessions', () => {
  it('sets a new random Lax cookie on every sign-in and stores only its hash', async () => {
    const s = invitedServer()
    const b = s.browser()
    expect(await b.signIn(ALICE)).toBe('signedIn')
    const first = b.session!
    const cookie = b.jar.get(SESSION_COOKIE)
    expect(cookie).toBe(first)
    expect(JSON.stringify(s.rows('sessions'))).not.toContain(first)
    expect(s.rows('sessions')).toHaveLength(1)
    // Signing in again while the old cookie is still presented replaces that session instead of adding another.
    expect(await b.signIn(ALICE)).toBe('signedIn')
    expect(b.session).not.toBe(first)
    expect(s.rows('sessions')).toHaveLength(1)
    expect(JSON.stringify(s.rows('sessions'))).not.toContain(b.session!)
  })

  it('the session cookie is HttpOnly, Secure, SameSite=Lax, host-only, 180 days', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state, nonce, challenge } = await b.start()
    const code = s.identity.issueCode(ALICE, { challenge, nonce })
    const { reply } = await b.callback({ state, code })
    const cookie = reply.setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('Secure')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${180 * 86_400}`)
    expect(cookie).not.toContain('Domain')
    expect(reply.setCookies.some((c) => c.startsWith(`${FLOW_COOKIE}=;`) && /Max-Age=0/.test(c))).toBe(true)
    expect(reply.status).toBe(303)
    expect(reply.headers.get('location')).toBe(`${APP}/?account=signedIn#/settings/account`)
  })

  it('reports the account to a signed-in device and nothing to a signed-out one', async () => {
    const s = invitedServer()
    const b = s.browser()
    expect((await b.sessionStatus()).body).toEqual({ signedIn: false })
    await b.signIn(ALICE)
    const status = (await b.sessionStatus()).body!
    expect(status).toEqual({ signedIn: true, accountKey: await accountKeyOf(ALICE.sub), email: ALICE.email, consentVersion: 1 })
  })

  it('goes idle after 180 days, and activity keeps it alive', async () => {
    const s = invitedServer()
    const b = s.browser()
    await b.signIn(ALICE)
    s.advance(100 * 86_400)
    expect((await b.sessionStatus()).body!.signedIn).toBe(true)
    s.advance(100 * 86_400)
    expect((await b.sessionStatus()).body!.signedIn).toBe(true)
    s.advance(181 * 86_400)
    expect((await b.sessionStatus()).body!.signedIn).toBe(false)
  })

  it('sign out deletes the session row and clears the cookie; the old cookie no longer works', async () => {
    const s = invitedServer()
    const b = s.browser()
    await b.signIn(ALICE)
    const old = b.session!
    const reply = await b.signOut()
    expect(reply.status).toBe(200)
    expect(s.rows('sessions')).toEqual([])
    expect(b.session).toBeUndefined()
    const replay = s.browser()
    replay.jar.set(SESSION_COOKIE, old)
    expect((await replay.sessionStatus()).body).toEqual({ signedIn: false })
  })

  it('stores no Google token anywhere', async () => {
    const s = invitedServer()
    await s.browser().signIn(ALICE)
    const everything = JSON.stringify(['accounts', 'identities', 'sessions', 'auth_pending', 'plans', 'beta_access', 'deleted_accounts'].map((table) => s.rows(table)))
    expect(everything).not.toContain('at-SECRET-123')
    expect(everything).not.toContain('refresh')
  })
})

describe('S1 the invite-only beta', () => {
  it('refuses a person who was not invited, and creates nothing', async () => {
    const s = server()
    const b = s.browser()
    expect(await b.signIn(ALICE)).toBe('notInvited')
    expect(b.session).toBeUndefined()
    for (const table of ['accounts', 'identities', 'sessions', 'plans']) expect(s.rows(table), table).toEqual([])
  })

  it('an invite works once: it binds to the first account, and the e-mail is not the identity key', async () => {
    const s = server()
    s.invite(ALICE.email)
    const first = s.browser()
    expect(await first.signIn(ALICE)).toBe('signedIn')
    const [invite] = s.rows('beta_access')
    expect(invite!.account_id).toBeTruthy()
    // Another Google identity claiming the same e-mail cannot reuse the invite.
    const second = s.browser()
    expect(await second.signIn({ sub: '100000000000000000099', email: ALICE.email })).toBe('notInvited')
    expect(s.rows('accounts')).toHaveLength(1)
  })

  it('a returning person whose e-mail changed still signs in by subject', async () => {
    const s = invitedServer()
    await s.browser().signIn(ALICE)
    const again = s.browser()
    expect(await again.signIn({ sub: ALICE.sub, email: 'alice.new@example.com' })).toBe('signedIn')
    expect(s.rows('identities')).toHaveLength(1)
    expect(s.rows('identities')[0]!.email).toBe('alice.new@example.com')
  })

  it('removing the invite ends the access: the session stops working and a new sign-in is refused', async () => {
    const s = invitedServer()
    const b = s.browser()
    await b.signIn(ALICE)
    s.db.sqlite.prepare('DELETE FROM beta_access WHERE email = ?').run(ALICE.email)
    expect((await b.sessionStatus()).body).toEqual({ signedIn: false })
    expect(await s.browser().signIn(ALICE)).toBe('notInvited')
  })

  it('stores the consent version and time of sign-up', async () => {
    const s = invitedServer()
    await s.browser().signIn(ALICE)
    const [account] = s.rows('accounts')
    expect(account!.consent_version).toBe(1)
    expect(account!.consent_at).toBe(Math.floor(s.clock.now / 1000))
    expect(account!.account_key).toBe(await accountKeyOf(ALICE.sub))
  })

  it('stores neither the name nor any other profile field', async () => {
    const s = invitedServer()
    const b = s.browser()
    const { state, nonce, challenge } = await b.start()
    const code = s.identity.issueCode({ ...ALICE, claims: { name: 'Alice Synthetic', picture: 'https://example.com/a.png', given_name: 'Alice' } }, { challenge, nonce })
    await b.callback({ state, code })
    const everything = JSON.stringify(['accounts', 'identities', 'sessions'].map((table) => s.rows(table)))
    expect(everything).not.toContain('Synthetic')
    expect(everything).not.toContain('picture')
  })
})
