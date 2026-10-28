// @vitest-environment node
// S-10: Functions run only under /api/google/*, and each route file exports exactly one method handler.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import './testing/harness'

const root = fileURLToPath(new URL('../../', import.meta.url))

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    return statSync(path).isDirectory() ? files(path) : [relative(root, path)]
  })
}

const EXPECTED: Record<string, 'onRequestGet' | 'onRequestPost'> = {
  'functions/api/google/connect.ts': 'onRequestPost',
  'functions/api/google/callback.ts': 'onRequestGet',
  'functions/api/google/token.ts': 'onRequestPost',
  'functions/api/google/status.ts': 'onRequestPost',
  'functions/api/google/disconnect.ts': 'onRequestPost',
  'functions/api/google/canary/index.ts': 'onRequestGet',
  'functions/api/google/canary/script.ts': 'onRequestGet',
}

describe('S-10 routes', () => {
  it('public/_routes.json routes only /api/google/* to Functions', () => {
    expect(JSON.parse(readFileSync(join(root, 'public/_routes.json'), 'utf8'))).toEqual({ version: 1, include: ['/api/google/*'], exclude: [] })
  })

  it('functions/ holds exactly the Google routes', () => {
    expect(files(join(root, 'functions')).sort()).toEqual(Object.keys(EXPECTED).sort())
  })

  it.each(Object.entries(EXPECTED))('%s exports only %s', async (file, method) => {
    const exports = Object.keys(await import(/* @vite-ignore */ join(root, file)))
    expect(exports).toEqual([method])
  })
})
