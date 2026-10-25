import type { ColorKey } from '@/core/model'

export type ShareTheme = 'light' | 'dark'

// The card's colours: the same values as src/assets/tokens.css (palette.spec parses tokens.css and compares), because
// a canvas cannot read custom properties. The card is a Summary card: --surface behind, --surface-2 for free hours,
// category strokes (3:1 on every surface) for planned hours.
export interface SharePalette {
  background: string
  free: string
  freeEdge: string
  label: string
  label2: string
  tintLabel: string
  category: Record<ColorKey, string>
}

const LIGHT: SharePalette = {
  background: '#ffffff',
  free: '#f2f2f7',
  freeEdge: 'rgba(60, 60, 67, 0.29)',
  label: '#000000',
  label2: 'rgba(60, 60, 67, 0.75)',
  tintLabel: 'hsl(240.9375 60.952381% 57%)',
  category: {
    blue: '#0088ff', green: '#2a9f47', orange: '#c97600', pink: '#e5399e', purple: '#af52de',
    teal: '#2997ab', yellow: '#a88700', red: '#ff3b30', gray: '#8a8a8f',
  },
}

const DARK: SharePalette = {
  background: '#1c1c1e',
  free: '#2c2c2e',
  freeEdge: 'rgba(84, 84, 88, 0.65)',
  label: '#ffffff',
  label2: 'rgba(235, 235, 245, 0.6)',
  tintLabel: 'hsl(241.353383 100% 79%)',
  category: {
    blue: '#1a94ff', green: '#30d158', orange: '#ff9f0a', pink: '#ff52b4', purple: '#bf5af2',
    teal: '#40c8e0', yellow: '#ffd60a', red: '#ff453a', gray: '#98989d',
  },
}

// The token each palette entry mirrors, for the spec that keeps them equal.
export const PALETTE_TOKENS: Record<Exclude<keyof SharePalette, 'category'>, string> = {
  background: '--surface',
  free: '--surface-2',
  freeEdge: '--separator',
  label: '--label',
  label2: '--label-2',
  tintLabel: '--tint-label',
}

export function paletteFor(theme: ShareTheme): SharePalette {
  return theme === 'dark' ? DARK : LIGHT
}
