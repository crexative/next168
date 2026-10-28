// @vitest-environment node
// The declared Node range must not admit a version the server toolchain cannot run: Wrangler's own engines floor,
// and `node:sqlite` without a flag (22.13), which the server tests use.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import './testing/harness'

const SQLITE_UNFLAGGED = [22, 13, 0]

type Version = number[]
const parse = (text: string): Version => text.split('.').map((part) => Number.parseInt(part, 10) || 0)
const compare = (a: Version, b: Version): number => a[0]! - b[0]! || a[1]! - b[1]! || a[2]! - b[2]!

/** The lowest version each `||` alternative admits (handles `>=x.y.z`, `^x.y.z`, `x.y.z`). */
function floor(range: string): Version {
  const lows = range.split('||').map((alternative) => parse(alternative.trim().replace(/^(>=|\^|~)/, '').split(/\s+/)[0]!))
  return lows.sort(compare)[0]!
}

const engines = (path: string): string => (JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as { engines: { node: string } }).engines.node

describe('toolchain Node floor', () => {
  it('package.json and its lockfile admit no Node older than Wrangler and node:sqlite need', () => {
    const declared = engines('../../package.json')
    const locked = (JSON.parse(readFileSync(new URL('../../package-lock.json', import.meta.url), 'utf8')) as { packages: Record<string, { engines?: { node: string } }> }).packages['']!.engines!.node
    expect(locked).toBe(declared)
    const needed = [floor(engines('../../node_modules/wrangler/package.json')), SQLITE_UNFLAGGED].sort(compare).at(-1)!
    expect(compare(floor(declared), needed), `engines.node ${declared} admits Node below ${needed.join('.')}`).toBeGreaterThanOrEqual(0)
  })

  it('the parser reads the ranges it guards', () => {
    expect(floor('^20.19.0 || >=22.12.0')).toEqual([20, 19, 0])
    expect(floor('>=22.13.0')).toEqual([22, 13, 0])
  })
})
