import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// The policy is a meta tag so it holds on every host (Cloudflare Pages, GitHub Pages, vite preview, the companion).
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://accounts.google.com/gsi/client",
  "style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self' https: http:",
  'frame-src https://accounts.google.com/gsi/',
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ')

const html = readFileSync(join(__dirname, '..', 'index.html'), 'utf8')

describe('the page Content Security Policy', () => {
  it('is the specified policy, in the first element of the head', () => {
    const head = html.slice(html.indexOf('<head>') + '<head>'.length).trimStart()
    expect(head.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true)
    const content = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1]
    expect(content).toBe(CONTENT_SECURITY_POLICY)
  })

  it('has no inline script, so script-src can stay free of unsafe-inline', () => {
    const scripts = [...html.matchAll(/<script\b([^>]*)>/g)].map((match) => match[1]!)
    expect(scripts.length).toBeGreaterThan(0)
    for (const attributes of scripts) expect(attributes, attributes).toMatch(/\bsrc="/)
    expect(html).not.toMatch(/<script\b[^>]*>\s*[^<\s]/)
    expect(html).not.toMatch(/\son[a-z]+\s*=/i)
    expect(/script-src[^;]*'unsafe-(inline|eval)'/.test(CONTENT_SECURITY_POLICY)).toBe(false)
  })

  it('loads the pre-paint script as a blocking classic script, before the app', () => {
    const tag = /<script src="\/prepaint\.js"><\/script>/.exec(html)
    expect(tag).not.toBeNull()
    expect(tag!.index).toBeLessThan(html.indexOf('</head>'))
  })
})
