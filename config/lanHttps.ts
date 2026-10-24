import { readFileSync } from 'node:fs'
import type { ServerOptions } from 'node:https'

export function readPreviewHttps(env: Record<string, string | undefined>): ServerOptions | undefined {
  const cert = env.NEXT168_HTTPS_CERT
  const key = env.NEXT168_HTTPS_KEY
  if (!cert && !key) return undefined
  if (!cert || !key) {
    throw new Error('HTTPS preview requires both NEXT168_HTTPS_CERT and NEXT168_HTTPS_KEY. Run npm run lan:cert first.')
  }

  function read(path: string, variable: string): Buffer {
    try {
      return readFileSync(path)
    } catch {
      throw new Error(`Cannot read ${variable} at ${path}. Run npm run lan:cert first.`)
    }
  }

  return { cert: read(cert, 'NEXT168_HTTPS_CERT'), key: read(key, 'NEXT168_HTTPS_KEY') }
}
