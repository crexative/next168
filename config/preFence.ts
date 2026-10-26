// Pinned earlier builds whose real code runs against the same storage as the new code:
// - the last commit before the storage fence: its code opens both IndexedDB databases at version 1. The fence tests run
//   that code (Vitest alias `@old/*`, and an e2e build served at `/old/`);
// - the last commit fenced at storage version 2 (Vitest alias `@fencedV2/*`): the tasks P1 fence bump must exclude it.
// They are pinned, not merge-bases: once a fence merges, a merge-base would contain the fence itself.
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PRE_FENCE_COMMIT = '239b9bccd493bc992dc067b39aa0b22ca319f890'
export const FENCED_V2_COMMIT = 'd325df4a559289ee35566654eed0a1d461b61302'

interface PinnedTree { commit: string; cache: string; sourceVariable: string; label: string }

const PRE_FENCE: PinnedTree = { commit: PRE_FENCE_COMMIT, cache: 'next168-pre-fence', sourceVariable: 'NEXT168_PRE_FENCE_SOURCE', label: 'Pre-fence' }
const FENCED_V2: PinnedTree = { commit: FENCED_V2_COMMIT, cache: 'next168-fenced-v2', sourceVariable: 'NEXT168_FENCED_V2_SOURCE', label: 'Fenced-v2' }

function pinnedDir(root: string, tree: PinnedTree): string {
  return join(root, 'node_modules', '.cache', tree.cache, tree.commit)
}

export function preFenceDir(root: string): string {
  return pinnedDir(root, PRE_FENCE)
}

export function fencedV2Dir(root: string): string {
  return pinnedDir(root, FENCED_V2)
}

function git(root: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
}

// Stages a pinned tree once (a shallow CI clone fetches the commit first). Returns its directory.
function ensurePinnedSource(root: string, tree: PinnedTree): string {
  const dir = pinnedDir(root, tree)
  if (existsSync(join(dir, '.complete'))) return dir
  const staging = `${dir}.partial-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const source = process.env[tree.sourceVariable]
  if (source && existsSync(source) && statSync(source).isDirectory()) {
    cpSync(source, staging, { recursive: true })
    if (readFileSync(join(staging, '.commit'), 'utf8').trim() !== tree.commit) {
      throw new Error(`${tree.label} source commit must be ${tree.commit}: ${source}`)
    }
  } else {
    try {
      git(root, ['cat-file', '-e', `${tree.commit}^{commit}`])
    } catch {
      git(root, ['fetch', '--quiet', '--depth=1', 'origin', tree.commit])
    }
    const archive = git(root, ['archive', '--format=tar', tree.commit])
    execFileSync('tar', ['-x', '-C', staging], { input: archive })
  }
  writeFileSync(join(staging, '.complete'), tree.commit)
  if (existsSync(join(dir, '.complete'))) rmSync(staging, { recursive: true, force: true })
  else {
    rmSync(dir, { recursive: true, force: true })
    renameSync(staging, dir)
  }
  return dir
}

export function ensurePreFenceSource(root: string): string {
  return ensurePinnedSource(root, PRE_FENCE)
}

export function ensureFencedV2Source(root: string): string {
  return ensurePinnedSource(root, FENCED_V2)
}

// Builds the pre-fence app once (with the e2e hooks, like the new build) for the old/new e2e. Returns its dist.
export function ensurePreFenceBuild(root: string): string {
  const dir = ensurePreFenceSource(root)
  const dist = join(dir, 'dist')
  if (existsSync(join(dist, '.complete'))) return dist
  const modules = join(dir, 'node_modules')
  if (!existsSync(modules)) symlinkSync(join(root, 'node_modules'), modules, 'dir')
  execFileSync(join(root, 'node_modules', '.bin', 'vite'), ['build', '--outDir', 'dist', '--emptyOutDir', '--logLevel', 'warn'], {
    cwd: dir, stdio: 'inherit', env: { ...process.env, VITE_E2E: '1' },
  })
  writeFileSync(join(dist, '.complete'), PRE_FENCE_COMMIT)
  return dist
}
