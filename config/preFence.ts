// The last commit before the storage fence: its code opens both IndexedDB databases at version 1. The fence tests run
// that real code (Vitest alias `@old/*`, and an e2e build served at `/old/`) against the same storage as the new code.
// It is pinned, not a merge-base: once the fence merges, a merge-base would contain the fence itself.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const PRE_FENCE_COMMIT = '239b9bccd493bc992dc067b39aa0b22ca319f890'

export function preFenceDir(root: string): string {
  return join(root, 'node_modules', '.cache', 'next168-pre-fence', PRE_FENCE_COMMIT)
}

function git(root: string, args: string[]): Buffer {
  return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
}

// Extracts the pre-fence tree once (a shallow CI clone fetches the commit first). Returns its directory.
export function ensurePreFenceSource(root: string): string {
  const dir = preFenceDir(root)
  if (existsSync(join(dir, '.complete'))) return dir
  try {
    git(root, ['cat-file', '-e', `${PRE_FENCE_COMMIT}^{commit}`])
  } catch {
    git(root, ['fetch', '--quiet', '--depth=1', 'origin', PRE_FENCE_COMMIT])
  }
  const staging = `${dir}.partial-${process.pid}`
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  const archive = git(root, ['archive', '--format=tar', PRE_FENCE_COMMIT])
  execFileSync('tar', ['-x', '-C', staging], { input: archive })
  writeFileSync(join(staging, '.complete'), PRE_FENCE_COMMIT)
  if (existsSync(join(dir, '.complete'))) rmSync(staging, { recursive: true, force: true })
  else {
    rmSync(dir, { recursive: true, force: true })
    renameSync(staging, dir)
  }
  return dir
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
