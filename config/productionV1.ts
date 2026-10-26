// The app GitHub Pages served before Weeklid (https://crexative.github.io/next168/, "Next168"): it kept the planner
// in localStorage `next168-data` and had no service worker. The upgrade e2e builds it from Git and replaces it with
// the new build at the same origin and path, as the first deploy of main does.
import { execFileSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { stageCommitTree } from './pinnedCommit'

export const PRODUCTION_V1_COMMIT = '05d781d9a884db89d0c42d87d6e9cdd364bd4a5c'
// Its vite base: the old build only runs under this path.
export const PRODUCTION_V1_BASE = '/next168/'
// The entry script GitHub Pages serves today: the build below reproduces it byte for byte.
export const PRODUCTION_V1_ENTRY = 'assets/index-ZedxSX_7.js'

// Outside node_modules on purpose: Vite's esbuild ignores tsconfig there, which changes the old build's output.
export function productionV1Dir(root: string): string {
  return join(root, '.production-v1', PRODUCTION_V1_COMMIT)
}

// Builds it once with its own locked dependencies (they differ from the new app's). Returns its dist.
export function ensureProductionV1Build(root: string): string {
  const dir = stageCommitTree(root, PRODUCTION_V1_COMMIT, productionV1Dir(root), 'Production v1')
  const dist = join(dir, 'dist')
  if (existsSync(join(dist, '.complete'))) return dist
  if (!existsSync(join(dir, 'node_modules', '.package-lock.json'))) {
    execFileSync('npm', ['ci', '--no-audit', '--no-fund', '--loglevel=error'], { cwd: dir, stdio: 'inherit' })
  }
  execFileSync(join(dir, 'node_modules', '.bin', 'vite'), ['build', '--outDir', 'dist', '--emptyOutDir', '--logLevel', 'warn'], { cwd: dir, stdio: 'inherit' })
  writeFileSync(join(dist, '.complete'), PRODUCTION_V1_COMMIT)
  return dist
}
