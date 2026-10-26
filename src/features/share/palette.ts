// Relative, so the E2E suite (no @ alias) can read the same palette.
import type { ColorKey } from '../../core/model'

export type ShareTheme = 'light' | 'dark'

// --font-sans, then colour emoji fonts so category icons draw in colour on every system.
export const CARD_FONT = "system-ui, -apple-system, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif, 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji'"

// The card's colours: the same values as src/assets/tokens.css (palette.spec parses tokens.css and compares), because
// a canvas cannot read custom properties. The card is a Summary card: --surface behind, --surface-2 for free hours,
// category strokes (3:1 on every surface) for planned hours, hollow grey outlines for "N others" (so free, planned and
// others never look alike). Weeklid's green (--mark) draws the W and the planned figure; maize (--accent) only the tick.
export interface SharePalette {
  background: string
  free: string
  label: string
  label2: string
  tintLabel: string
  mark: string
  accent: string
  category: Record<ColorKey, string>
}

const LIGHT: SharePalette = {
  background: '#ffffff',
  free: '#f2f2f7',
  label: '#000000',
  label2: 'rgba(60, 60, 67, 0.75)',
  tintLabel: 'hsl(149.69697 71.223022% 24.5%)',
  mark: '#147745',
  accent: '#c47a00',
  category: {
    blue: '#0088ff', green: '#2a9f47', orange: '#c97600', pink: '#e5399e', purple: '#af52de',
    teal: '#2997ab', yellow: '#a88700', red: '#ff3b30', gray: '#8a8a8f',
  },
}

const DARK: SharePalette = {
  background: '#1c1c1e',
  free: '#2c2c2e',
  label: '#ffffff',
  label2: 'rgba(235, 235, 245, 0.6)',
  tintLabel: '#5ad394',
  mark: '#5ad394',
  accent: '#ffc93c',
  category: {
    blue: '#1a94ff', green: '#30d158', orange: '#ff9f0a', pink: '#ff52b4', purple: '#bf5af2',
    teal: '#40c8e0', yellow: '#ffd60a', red: '#ff453a', gray: '#98989d',
  },
}

// The token each palette entry mirrors, for the spec that keeps them equal.
export const PALETTE_TOKENS: Record<Exclude<keyof SharePalette, 'category'>, string> = {
  background: '--surface',
  free: '--surface-2',
  label: '--label',
  label2: '--label-2',
  tintLabel: '--tint-label',
  mark: '--mark',
  accent: '--accent',
}

export function paletteFor(theme: ShareTheme): SharePalette {
  return theme === 'dark' ? DARK : LIGHT
}
