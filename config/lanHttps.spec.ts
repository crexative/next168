// @vitest-environment node
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readPreviewHttps } from './lanHttps'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'next168-https-'))
  directories.push(directory)
  return { cert: join(directory, 'server.crt'), key: join(directory, 'server.key') }
}

describe('readPreviewHttps', () => {
  it('leaves default HTTP preview unaffected without certificate paths', () => {
    expect(readPreviewHttps({})).toBeUndefined()
  })

  it('requires both paths when HTTPS is requested', () => {
    expect(() => readPreviewHttps({ NEXT168_HTTPS_CERT: 'server.crt' })).toThrow(/NEXT168_HTTPS_KEY/)
    expect(() => readPreviewHttps({ NEXT168_HTTPS_KEY: 'server.key' })).toThrow(/NEXT168_HTTPS_CERT/)
  })

  it('reads the certificate and private key from the configured files', () => {
    const { cert, key } = fixture()
    writeFileSync(cert, 'test certificate')
    writeFileSync(key, 'test private key')
    const https = readPreviewHttps({ NEXT168_HTTPS_CERT: cert, NEXT168_HTTPS_KEY: key })
    expect(https?.cert).toEqual(Buffer.from('test certificate'))
    expect(https?.key).toEqual(Buffer.from('test private key'))
  })

  it('reports a missing certificate with its path and the recovery command', () => {
    const { cert, key } = fixture()
    expect(() => readPreviewHttps({ NEXT168_HTTPS_CERT: cert, NEXT168_HTTPS_KEY: key }))
      .toThrow(`Cannot read NEXT168_HTTPS_CERT at ${cert}. Run npm run lan:cert first.`)
  })

  it('reports a missing key with its path and the recovery command', () => {
    const { cert, key } = fixture()
    writeFileSync(cert, 'test certificate')
    expect(() => readPreviewHttps({ NEXT168_HTTPS_CERT: cert, NEXT168_HTTPS_KEY: key }))
      .toThrow(`Cannot read NEXT168_HTTPS_KEY at ${key}. Run npm run lan:cert first.`)
  })
})
