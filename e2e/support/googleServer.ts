import type { BrowserContext, Route } from '@playwright/test'

// The Weeklid Google server (functions/api/google), faked through context.route. One fake per browser context, which is
// one device with its own cookie jar; contexts share a `World`, which is the Google account behind them. The reply
// shapes are the real ones, pinned by server/google/clientContract.spec.ts (A-2); the fake follows R-4 of the design:
// a Disconnect deletes the device's credential before revoking, and a confirmed revoke ends the account's grant.

export const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth?state=fake-state'
const CONNECTION = 'CCCCCCCCCCCCCCCCCCCCCC'
const PENDING = 'PPPPPPPPPPPPPPPPPPPPPP'
const EPOCH = /^[A-Za-z0-9_-]{22}$/

export type ServerRoute = 'connect' | 'token' | 'status' | 'disconnect'
export type Answer = { status: number; body: unknown } | 'abort'

export interface World {
  /** A confirmed revoke ended the grant: refreshes fail and every access token is refused. */
  grantRevoked: boolean
  /** What Google answers to the next revoke. */
  revokeAnswer: 'ok' | 'fail'
  tokens: Map<string, { device: string }>
  minted: number
}

export const newWorld = (): World => ({ grantRevoked: false, revokeAnswer: 'ok', tokens: new Map(), minted: 0 })

export interface LoggedRequest {
  route: ServerRoute
  method: string
  headers: Record<string, string>
  body: Record<string, unknown> | null
}

export type HoldPoint = 'afterRead' | 'afterMint'

export interface GoogleServerFake {
  requests: LoggedRequest[]
  /** The device cookie. Cleared, `/token` answers noDevice and `/disconnect` none, as the real server does. */
  cookie: boolean
  /** This device holds a credential on the server. */
  connected: boolean
  pending: boolean
  /** The callback committed: the device now holds a credential and the grant is live again. */
  completeConsent(): void
  /** The next answers for a route, one per request; 'abort' drops the connection. */
  reply(route: ServerRoute, ...answers: Answer[]): void
  /** Parks the next request of a route. `/token`: after reading the credential, or after minting but before the reply. */
  hold(route: ServerRoute, at?: HoldPoint): () => void
  count(route: ServerRoute): number
  tokenIsValid(token: string): boolean
}

const json = (status: number, body: unknown) => ({ status, body })
const code = (status: number, name: string) => json(status, { code: name })

export async function fakeGoogleServer(context: BrowserContext, world: World, device = 'device'): Promise<GoogleServerFake> {
  const queued = new Map<ServerRoute, Answer[]>()
  const holds = new Map<ServerRoute, { at: HoldPoint | undefined; release: Promise<void> }>()
  const fake: GoogleServerFake = {
    requests: [],
    cookie: true,
    connected: false,
    pending: false,
    completeConsent() {
      fake.cookie = true
      fake.connected = true
      fake.pending = false
      world.grantRevoked = false
    },
    reply(route, ...answers) {
      queued.set(route, [...(queued.get(route) ?? []), ...answers])
    },
    hold(route, at) {
      let release!: () => void
      holds.set(route, { at, release: new Promise<void>((resolve) => { release = resolve }) })
      return release
    },
    count: (route) => fake.requests.filter((request) => request.route === route).length,
    tokenIsValid: (token) => !world.grantRevoked && world.tokens.get(token)?.device === device,
  }
  const gen = () => `${fake.connected ? CONNECTION : '-'}.${fake.pending ? PENDING : '-'}`

  async function holdAt(route: ServerRoute, at: HoldPoint | undefined): Promise<void> {
    const held = holds.get(route)
    if (held && held.at === at) { holds.delete(route); await held.release }
  }

  async function answer(route: ServerRoute, request: LoggedRequest): Promise<Answer> {
    if (request.headers['x-weeklid'] !== '1') return code(403, 'forbidden')
    const scripted = queued.get(route)?.shift()
    if (scripted) { await holdAt(route, undefined); return scripted }
    switch (route) {
      case 'connect': {
        const body = request.body
        if (!body || body.from !== 'app' || typeof body.epoch !== 'string' || !EPOCH.test(body.epoch) || Object.keys(body).length !== 2) return code(400, 'badRequest')
        await holdAt(route, undefined)
        fake.cookie = true
        fake.pending = true
        return json(200, { url: AUTH_URL })
      }
      case 'token': {
        if (!fake.cookie) return code(401, 'noDevice')
        if (!fake.connected) return code(401, 'notConnected')
        await holdAt(route, 'afterRead')
        if (world.grantRevoked) return code(401, 'reconnect')
        world.minted += 1
        const accessToken = `at-${device}-${world.minted}`
        world.tokens.set(accessToken, { device })
        const reply = json(200, { accessToken, expiresIn: 3599, epoch: 'AAAAAAAAAAAAAAAAAAAAAA', pending: fake.pending })
        await holdAt(route, 'afterMint')
        return reply
      }
      case 'status':
        await holdAt(route, undefined)
        return fake.cookie ? json(200, { gen: gen(), connected: fake.connected, pending: fake.pending }) : json(200, { gen: '-.-', connected: false, pending: false })
      case 'disconnect': {
        const body = request.body
        if (!body || typeof body.revoke !== 'boolean' || typeof body.gen !== 'string') return code(400, 'badRequest')
        await holdAt(route, undefined)
        if (!fake.cookie) return json(200, { result: 'none' })
        if (body.gen !== gen()) return json(200, { result: 'stale', gen: gen() })
        const hadCredential = fake.connected
        if (!hadCredential && !fake.pending) return json(200, { result: 'none' })
        fake.connected = false
        fake.pending = false
        if (!hadCredential) return json(200, { result: 'none' })
        if (body.revoke !== true) return json(200, { result: 'forgotten' })
        if (world.revokeAnswer === 'ok') { world.grantRevoked = true; return json(200, { result: 'confirmed' }) }
        return json(200, { result: 'unconfirmed' })
      }
    }
  }

  await context.route((url) => url.pathname.startsWith('/api/google/'), async (route: Route) => {
    const request = route.request()
    const name = new URL(request.url()).pathname.replace('/api/google/', '') as ServerRoute
    const raw = request.postData()
    let body: Record<string, unknown> | null = null
    try { body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null } catch { body = null }
    const logged: LoggedRequest = { route: name, method: request.method(), headers: await request.allHeaders(), body }
    fake.requests.push(logged)
    const reply = await answer(name, logged)
    if (reply === 'abort') { await route.abort().catch(() => undefined); return }
    await route.fulfill({ status: reply.status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(reply.body) }).catch(() => undefined)
  })
  // The page leaves for Google's consent screen; the test then simulates the callback by navigating back.
  await context.route('https://accounts.google.com/o/oauth2/v2/auth**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Google consent</title>' }))
  return fake
}
