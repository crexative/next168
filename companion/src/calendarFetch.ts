import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import http from 'node:http'
import https from 'node:https'
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib'
import type { Readable } from 'node:stream'

export const MAX_CALENDAR_BYTES = 5 * 1024 * 1024
interface Address { address: string; family: number }
type Resolver = (hostname: string) => Promise<Address[]>
interface CalendarResponse { status: number; text: string; location?: string }
interface FetchDependencies {
  resolve?: Resolver
  request?: (url: URL, address: Address, signal: AbortSignal) => Promise<CalendarResponse>
}
export function isPublicAddress(raw: string): boolean {
  const address = raw.replace(/^\[|\]$/g, '').toLowerCase()
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number)
    return !(a === 0 || a === 10 || a === 127 || a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) || (a === 203 && b === 0 && c === 113))
  }
  if (isIP(address) !== 6) return false
  // Only native global unicast is eligible; mapped/translation/tunnel and reserved ranges are denied.
  if (address.includes('.') || address.includes('%')) return false
  const first = Number.parseInt(address.split(':')[0] ?? '', 16)
  const second = Number.parseInt(address.split(':')[1] || '0', 16)
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 &&
    !(first === 0x2001 && (second < 0x200 || second === 0xdb8)) &&
    !(first === 0x3fff && second < 0x1000)
}
export async function resolvePublicTarget(url: URL, resolve: Resolver = hostname => lookup(hostname, { all: true, verbatim: true })): Promise<Address> {
  if (!['http:', 'https:'].includes(url.protocol)) throw Error('calendar.scheme-not-allowed')
  const hostname = url.hostname.replace(/^\[|\]$/g, '')
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await resolve(hostname)
  if (!addresses.length || addresses.some(item => !isPublicAddress(item.address))) throw Error('calendar.private-address')
  return addresses[0]!
}
function pinnedRequest(url: URL, address: Address, signal: AbortSignal): Promise<CalendarResponse> {
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: 'GET', signal, agent: false,
      headers: { Accept: 'text/calendar', 'Accept-Encoding': 'gzip, deflate, br' },
      lookup: (_hostname, options, callback) => {
        if (options.all) callback(null, [{ address: address.address, family: address.family }])
        else callback(null, address.address, address.family)
      },
    }, async response => {
      const status = response.statusCode ?? 0
      if (status !== 200) {
        response.destroy()
        resolve({ status, text: '', location: response.headers.location }); return
      }
      let body: Readable = response
      const encoding = response.headers['content-encoding']
      const decompress = encoding === 'gzip' ? createGunzip() : encoding === 'deflate' ? createInflate() : encoding === 'br' ? createBrotliDecompress() : undefined
      if (encoding && encoding !== 'identity' && !decompress) { response.destroy(); reject(Error('calendar.encoding')); return }
      if (decompress) {
        response.on('error', error => decompress.destroy(error))
        body = response.pipe(decompress)
      }
      const onAbort = () => { body.destroy(Error('calendar.timeout')); response.destroy() }
      signal.addEventListener('abort', onAbort, { once: true })
      try {
        const chunks: Buffer[] = []; let bytes = 0
        for await (const chunk of body) {
          const buffer = Buffer.from(chunk)
          bytes += buffer.length
          if (bytes > MAX_CALENDAR_BYTES) throw Error('calendar.too-large')
          chunks.push(buffer)
        }
        resolve({ status, text: Buffer.concat(chunks).toString('utf8') })
      } catch (error) { body.destroy(); response.destroy(); reject(error) }
      finally { signal.removeEventListener('abort', onAbort) }
    })
    request.on('error', reject)
    request.end()
  })
}
export async function fetchCalendar(input: string, dependencies: FetchDependencies = {}): Promise<string> {
  const controller = new AbortController()
  let timeout: ReturnType<typeof setTimeout> | undefined
  const timedOut = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => { controller.abort(); reject(Error('calendar.timeout')) }, 10_000)
  })
  const fetch = async () => {
    let url = new URL(input)
    for (let redirects = 0; redirects <= 3; redirects++) {
      url.username = ''; url.password = ''; url.hash = ''
      const address = await resolvePublicTarget(url, dependencies.resolve)
      controller.signal.throwIfAborted()
      const response = await (dependencies.request ?? pinnedRequest)(url, address, controller.signal)
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (!response.location || redirects === 3) throw Error('calendar.redirect-limit')
        url = new URL(response.location, url); continue
      }
      if (response.status !== 200) throw Error(`calendar.http-${response.status}`)
      if (Buffer.byteLength(response.text, 'utf8') > MAX_CALENDAR_BYTES) throw Error('calendar.too-large')
      return response.text
    }
    throw Error('calendar.redirect-limit')
  }
  try { return await Promise.race([fetch(), timedOut]) } finally { clearTimeout(timeout) }
}
