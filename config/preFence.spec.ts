// @vitest-environment node
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ensurePreFenceSource, PRE_FENCE_COMMIT, preFenceDir } from './preFence'

const directories: string[] = []

afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function fixture(commit = PRE_FENCE_COMMIT) {
  const root = mkdtempSync(join(tmpdir(), 'next168-pre-fence-'))
  directories.push(root)
  const source = join(root, '.pre-fence-source')
  mkdirSync(join(source, 'src'), { recursive: true })
  writeFileSync(join(source, '.commit'), `${commit}\n`)
  writeFileSync(join(source, 'src', 'app.ts'), 'export const version = 1\n')
  vi.stubEnv('NEXT168_PRE_FENCE_SOURCE', source)
  return { root, source }
}

describe('ensurePreFenceSource', () => {
  it('stages the supplied tree without a Git repository and reuses the completed cache', () => {
    const { root, source } = fixture()

    const dir = ensurePreFenceSource(root)

    expect(dir).toBe(preFenceDir(root))
    expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toBe('export const version = 1\n')
    expect(readFileSync(join(dir, '.complete'), 'utf8')).toBe(PRE_FENCE_COMMIT)
    expect(existsSync(`${dir}.partial-${process.pid}`)).toBe(false)
    writeFileSync(join(dir, 'src', 'app.ts'), 'cached tree')
    expect(readFileSync(join(source, 'src', 'app.ts'), 'utf8')).toBe('export const version = 1\n')
    expect(ensurePreFenceSource(root)).toBe(dir)
    expect(readFileSync(join(dir, 'src', 'app.ts'), 'utf8')).toBe('cached tree')
  })

  it('rejects a tree with a different commit before publishing the cache', () => {
    const { root } = fixture('0'.repeat(40))

    expect(() => ensurePreFenceSource(root)).toThrow(/pre-fence.*commit/i)
    expect(existsSync(preFenceDir(root))).toBe(false)
  })

  it('rejects a tree without a commit marker before publishing the cache', () => {
    const { root, source } = fixture()
    rmSync(join(source, '.commit'))

    expect(() => ensurePreFenceSource(root)).toThrow(/\.commit/)
    expect(existsSync(preFenceDir(root))).toBe(false)
  })
})
