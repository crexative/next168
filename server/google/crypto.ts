// Web Crypto only, so the same code runs on Cloudflare's runtime and in Node's tests.

export type RandomSource = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>

export const systemRandom: RandomSource = (bytes) => crypto.getRandomValues(bytes)

const encoder = new TextEncoder()
const decoder = new TextDecoder()

export function base64url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function fromBase64url(text: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) throw new SyntaxError('not base64url')
  const binary = atob(text.replace(/-/g, '+').replace(/_/g, '/'))
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

// Accepts the standard alphabet with padding (`openssl rand -base64 32`) and the URL-safe one.
export function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  const trimmed = text.trim()
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(trimmed)) return null
  try {
    return fromBase64url(trimmed.replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'))
  } catch {
    return null
  }
}

export function randomId(random: RandomSource, byteLength: number): string {
  return base64url(random(new Uint8Array(byteLength)))
}

export async function sha256b64url(text: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
}

export const pkceChallenge = sha256b64url

export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a)
  const right = encoder.encode(b)
  let difference = left.length ^ right.length
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ (right[i % Math.max(right.length, 1)] ?? 0)
  return difference === 0
}

export const tokenAad = (deviceHash: string): string => `weeklid/google/token/v1/${deviceHash}`
export const pkceAad = (deviceHash: string): string => `weeklid/google/pkce/v1/${deviceHash}`

export interface Sealed {
  iv: string
  ciphertext: string
}

function importKey(key: Uint8Array<ArrayBuffer>) {
  return crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function seal(key: Uint8Array<ArrayBuffer>, aad: string, plaintext: string, random: RandomSource): Promise<Sealed> {
  const iv = random(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: encoder.encode(aad) }, await importKey(key), encoder.encode(plaintext))
  return { iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)) }
}

// Rejects (OperationError) when the key, the AAD or the ciphertext does not match.
export async function open(key: Uint8Array<ArrayBuffer>, aad: string, sealed: Sealed): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64url(sealed.iv), additionalData: encoder.encode(aad) },
    await importKey(key),
    fromBase64url(sealed.ciphertext),
  )
  return decoder.decode(plaintext)
}

// Identifies the key a row was sealed with, without revealing it; a replaced key makes every row `reconnect`.
export async function keyId(key: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', key))
  return base64url(digest.subarray(0, 12))
}

// The pending row keeps the sealed PKCE verifier in one column as `<iv>.<ciphertext>`.
export const packSealed = (sealed: Sealed): string => `${sealed.iv}.${sealed.ciphertext}`

export function unpackSealed(packed: string): Sealed | null {
  const [iv, ciphertext, extra] = packed.split('.')
  return iv && ciphertext && extra === undefined ? { iv, ciphertext } : null
}
