import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

const FIRST_PORT = 20000
const SLOTS = 6000
const PORTS_PER_SLOT = 3

// Three adjacent ports (root server, sub-path server, server-mode build) from a stable hash of this checkout's path, so
// concurrent runs in different worktrees never share a preview server. PW_PORT_BASE overrides it.
export function previewPorts(checkout: string = fileURLToPath(new URL('../..', import.meta.url)), override: string | undefined = process.env.PW_PORT_BASE): { root: number; subpath: number; server: number } {
  if (override !== undefined) {
    const base = Number(override)
    if (!Number.isInteger(base) || base < 1024 || base > 65533) throw new Error(`PW_PORT_BASE must be an integer from 1024 to 65533, got "${override}"`)
    return { root: base, subpath: base + 1, server: base + 2 }
  }
  const slot = createHash('sha256').update(checkout).digest().readUInt32BE(0) % SLOTS
  const root = FIRST_PORT + slot * PORTS_PER_SLOT
  return { root, subpath: root + 1, server: root + 2 }
}
