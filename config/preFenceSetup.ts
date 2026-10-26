import { fileURLToPath } from 'node:url'
import { ensureFencedV2Source, ensurePreFenceSource } from './preFence'

// Vitest global setup: the `@old/*` and `@fencedV2/*` modules must exist before any spec imports them.
export default function setup(): void {
  const root = fileURLToPath(new URL('..', import.meta.url))
  ensurePreFenceSource(root)
  ensureFencedV2Source(root)
}
