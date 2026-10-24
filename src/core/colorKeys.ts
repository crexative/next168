import { COLOR_KEYS, type ColorKey } from './model'

// The first palette colour not yet in use; once every colour is taken, the least used one (first in palette order on ties).
export function firstUnusedColorKey(used: readonly ColorKey[]): ColorKey {
  const counts = new Map<ColorKey, number>(COLOR_KEYS.map((key) => [key, 0]))
  for (const key of used) counts.set(key, (counts.get(key) ?? 0) + 1)
  const least = Math.min(...counts.values())
  return COLOR_KEYS.find((key) => counts.get(key) === least)!
}
