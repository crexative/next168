// Lets the browser-side client talk to the real S1a handlers in a node test: its fetch goes through the harness
// server with the cookies of one Browser, as a same-origin page would.
import { createServerConnection, type LockPort, type ServerConnection, type ServerEnvironment } from '../../../src/features/calendars/google/serverConnection'
import { APP, type Browser } from './harness'

export interface Bridge {
  connection: ServerConnection
  /** Every request path the client sent. */
  paths: string[]
}

export function clientFor(browser: Browser, options: { locks?: boolean; origin?: string } = {}): Bridge {
  const paths: string[] = []
  const bridgedFetch: ServerEnvironment['fetch'] = async (path, init) => {
    paths.push(path)
    const headers = new Headers(init.headers)
    headers.set('origin', options.origin ?? APP)
    headers.set('sec-fetch-site', 'same-origin')
    if (browser.jar.size) headers.set('cookie', [...browser.jar].map(([name, value]) => `${name}=${value}`).join('; '))
    const response = await browser.server.send(new Request(`${options.origin ?? APP}${path}`, { method: init.method, headers, body: init.body ?? null, signal: init.signal }))
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';')
      const index = pair!.indexOf('=')
      browser.jar.set(pair!.slice(0, index), pair!.slice(index + 1))
    }
    return response
  }
  const locks: LockPort | undefined = options.locks === false ? undefined : { request: (_name, _options, task) => task() }
  const connection = createServerConnection({ fetch: bridgedFetch, locks, randomBytes: (length) => Uint8Array.from({ length }, (_, i) => (i * 13 + 7) & 0xff) })
  return { connection, paths }
}
