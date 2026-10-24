import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const FIRST_PORT = 20000
const SLOTS = 10000

// Two adjacent ports (root server, sub-path server) from a stable hash of this checkout's path, so
// concurrent runs in different worktrees never share a preview server. PW_PORT_BASE overrides it.
export function previewPorts(checkout: string = fileURLToPath(new URL('../..', import.meta.url)), override: string | undefined = process.env.PW_PORT_BASE): { root: number; subpath: number } {
  if (override !== undefined) {
    const base = Number(override)
    if (!Number.isInteger(base) || base < 1024 || base > 65534) throw new Error(`PW_PORT_BASE must be an integer from 1024 to 65534, got "${override}"`)
    return { root: base, subpath: base + 1 }
  }
  const slot = createHash('sha256').update(checkout).digest().readUInt32BE(0) % SLOTS
  const root = FIRST_PORT + slot * 2
  return { root, subpath: root + 1 }
}
