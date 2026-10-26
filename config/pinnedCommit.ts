// Stages the tree of one pinned commit into `dir` once, for tests that run or build an older version of the app.
// A shallow CI clone fetches the commit first. `localSource` (a copied tree with a `.commit` marker) replaces Git.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

function git(root: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
}

export function stageCommitTree(root: string, commit: string, dir: string, label: string, localSource?: string): string {
  if (existsSync(join(dir, '.complete'))) return dir
  const staging = `${dir}.partial-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  if (localSource && existsSync(localSource) && statSync(localSource).isDirectory()) {
    cpSync(localSource, staging, { recursive: true })
    if (readFileSync(join(staging, '.commit'), 'utf8').trim() !== commit) {
      throw new Error(`${label} source commit must be ${commit}: ${localSource}`)
    }
  } else {
    try {
      git(root, ['cat-file', '-e', `${commit}^{commit}`])
    } catch {
      git(root, ['fetch', '--quiet', '--depth=1', 'origin', commit])
    }
    const archive = git(root, ['archive', '--format=tar', commit])
    execFileSync('tar', ['-x', '-C', staging], { input: archive })
  }
  writeFileSync(join(staging, '.complete'), commit)
  if (existsSync(join(dir, '.complete'))) rmSync(staging, { recursive: true, force: true })
  else {
    rmSync(dir, { recursive: true, force: true })
    renameSync(staging, dir)
  }
  return dir
}
