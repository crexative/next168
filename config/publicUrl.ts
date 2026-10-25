// The address printed on shared images. It must be a public HTTPS page: never a LAN address, a loopback or
// development name, credentials or a query/fragment that could carry a private token. Used by vite.config.ts (an
// invalid value fails the build) and by src/app/brand.ts.
export type PublicUrlResult = { ok: true; url: string } | { ok: false; reason: string }

const IPV4_LITERAL = /^\d+(\.\d+){3}$/
const PRIVATE_SUFFIXES = ['.localhost', '.local', '.internal']

export function validatePublicUrl(raw: string): PublicUrlResult {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'not a URL' }
  }
  if (url.protocol !== 'https:') return { ok: false, reason: 'must use https' }
  if (url.username !== '' || url.password !== '') return { ok: false, reason: 'must not carry credentials' }
  if (url.search !== '' || url.hash !== '' || raw.includes('?') || raw.includes('#')) return { ok: false, reason: 'must not have a query or fragment' }
  const host = url.hostname.toLowerCase()
  if (host.startsWith('[') || host.includes(':')) return { ok: false, reason: 'must not be an IPv6 address' }
  if (IPV4_LITERAL.test(host)) return { ok: false, reason: 'must not be an IPv4 address' }
  if (host === 'localhost' || PRIVATE_SUFFIXES.some((suffix) => host.endsWith(suffix))) return { ok: false, reason: 'must not be a local name' }
  if (!host.includes('.')) return { ok: false, reason: 'must be a public domain name' }
  return { ok: true, url: url.href }
}

// The address as people read it on the image: no scheme and no trailing slash ("next168.app").
export function displayPublicUrl(url: string): string {
  return url.replace(/^https:\/\//, '').replace(/\/$/, '')
}
