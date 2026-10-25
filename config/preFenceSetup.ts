import { fileURLToPath } from 'node:url'
import { ensurePreFenceSource } from './preFence'

// Vitest global setup: the `@old/*` modules must exist before any spec imports them.
export default function setup(): void {
  ensurePreFenceSource(fileURLToPath(new URL('..', import.meta.url)))
}
