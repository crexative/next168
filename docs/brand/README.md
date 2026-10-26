# Weeklid brand: Lidera

Weeklid (formerly Next168) is a weekly planner. Its identity, **Lidera**, is one drawn stroke: it writes the W of
the name, and its last stroke rises into a check. *Lidera tu semana*: the letter itself leads the week and closes
it. The owner's brief for the colour: a green that catches the eye and reads as calm and natural, like the control
of having every pending item done.

- **Coffee-farm green** (#147745) carries the W, the app's tint and the icon tile. Green means done.
- **Maize** (#C47A00 on light, #FFC93C on dark) is the tick, and only the tick.
- Rooted in Colombia's coffee and maize farms without being a flag.

## Files

| File | Use |
|---|---|
| `symbol.svg`, `symbol-dark.svg`, `symbol-mono.svg` | The bare symbol on light, on dark, and single colour |
| `wordmark.svg`, `wordmark-dark.svg` | "Weeklid" alone |
| `lockup-horizontal(-dark).svg`, `lockup-stacked(-dark).svg` | Symbol with wordmark |
| `icon-master.svg` (1024), `icon-dark.svg`, `icon-any.svg`, `icon-maskable.svg`, `icon-monochrome.svg` | App icon sources: tile with white W and maize tick; dark tile; maskable with the symbol inside the safe zone; monochrome for themed icons |
| `favicon.svg`, `favicon-16.svg` | The favicon on a 32 px grid, and a pixel-tuned 16 px drawing |
| `palette.json` | Light and dark tokens with measured contrast |

The installed PNGs (pwa 64/192/512, maskable 512, monochrome 512, apple-touch 180, favicon 16/32/.ico) are in
`public/` and listed in the web manifest (`vite.config.ts`). They were rendered from these sources; do not
regenerate them from a single SVG, which would lose the 16 px drawing and the monochrome icon.

In the app, `src/ui/AppMark.vue` (symbol) and `src/ui/BrandLockup.vue` (horizontal lockup) draw the same paths
(`src/ui/brandMark.ts`) in tokens, so they follow light, dark and increased contrast. Both are named "Weeklid" for
screen readers.

## Palette

Ratios are WCAG 2.2 contrast, measured from the hex values (`src/ui/brand.contrast.spec.ts` keeps the app ones).

### Brand

| Role | Light | Dark |
|---|---|---|
| primary (W, tile) | #147745 | #5AD394 |
| accent (tick) | #C47A00 | #FFC93C |
| icon tile | #147745 | #0E1F16 |
| ink / ink-2 | #14141F / #5B5B6B | #F4F4F7 / #A6A6B4 |

| Pair | Ratio | Needs |
|---|---|---|
| primary text on white | 5.59 | 4.5 |
| primary text on #F4F4F8 | 5.10 | 4.5 |
| white label on primary | 5.59 | 4.5 |
| primary-dark text on #1C1C22 | 9.03 | 4.5 |
| white W on icon tile | 5.59 | 3 |
| maize tick on icon tile | 3.64 | 3 |
| W on dark icon tile | 9.12 | 3 |
| maize (light) on white | 3.43 | 3 |
| maize (dark) on #1C1C22 | 11.04 | 3 |

### In the app (`src/assets/tokens.css`)

| Token | Role | Light | Dark |
|---|---|---|---|
| `--tint` | Filled buttons, selection, progress, focus ring | #147745 | #18864F |
| `--tint-text` | Label on a filled tint | #FFFFFF | #FFFFFF |
| `--tint-label` | Green text and icons | hsl(149.7 71.2% 24.5%) = #126B3E | #5AD394 |
| `--mark` | The symbol's W | #147745 | #5AD394 |
| `--accent` | The symbol's tick, nothing else | #C47A00 | #FFC93C |

The dark tint is the brand green at the same hue and saturation, lifted only as far as white labels allow: the
brand's own dark primary (#5AD394) is too light to carry a white label and too close to the system green
(#30D158, OKLab distance 0.078) used for the green category and success.

| Pair (app surfaces: light #F2F2F7 / #FFFFFF, dark #000000 / #1C1C1E / #2C2C2E) | Light | Dark | Needs |
|---|---|---|---|
| `--tint-text` on `--tint` | 5.59 | 4.60 | 4.5 |
| `--tint-label` on surfaces | 5.88 - 6.57 | 7.42 - 11.18 | 4.5 |
| `--tint-label` over a 12 % tint fill | 5.01 - 5.55 | 6.63 - 10.33 | 4.5 |
| `--tint-label` over a 14 % tint fill | 4.87 - 5.39 | 6.50 - 10.16 | 4.5 |
| `--tint` on surfaces (focus ring, controls) | 5.01 - 5.59 | 3.03 - 4.56 | 3 |
| `--mark` on surfaces | 5.01 - 5.59 | 7.42 - 11.18 | 3 |
| `--accent` on surfaces | 3.07 - 3.43 | 9.07 - 13.67 | 3 |

Distance from other meanings (OKLab, 0.12 or more reads as a different colour; `palette.contrast.spec.ts`): the
tint is 0.19 to 0.40 away from every category colour and from success, warning and destructive, in both
appearances. The conflict ⚠ and its border stay in the destructive red, 0.34 from the tint. Maize is close to
warning orange (0.13 light, 0.10 dark) and to the dark yellow category (0.04), which is why it never marks state.

## Clear space and minimum sizes

- Clear space: the height of the wordmark's capital W on every side of a lockup; 25 % of the symbol's width around
  the bare symbol.
- Minimum size: symbol 16 px (below 24 px use the pixel-tuned favicon drawing); horizontal lockup 96 px wide;
  wordmark alone 64 px wide.
- On colour: the white or primary-dark symbol on its tile. Never the bare symbol on a photo; use the tile.

## Don't

- Use the tick alone or detach it from the W.
- Rebuild the W from a typeface: it is one drawn stroke with round caps and joins.
- Make the stroke thin: below 12.5 % of the box it breaks at 16 px.
- Stretch, rotate, outline, add shadows, or retype the wordmark in another font.
- Use maize for UI state, badges or text: it belongs to the tick.
- Paint the system chrome green: the installed app's bars match the page background (`theme-color`), and the
  brand lives in the icon, the tint and the mark.

## Font credit

The wordmark is set in **Plus Jakarta Sans** (weight 720) by Tokotype, licensed under the **SIL Open Font License
1.1**, and outlined to paths, so the app loads no font file.

## Technical names that stay "next168"

So existing data and setups keep working, the rename does not touch: the IndexedDB databases (`next168`,
`next168-calendars`), localStorage keys (`next168-*`), the export format id (`next168-export`), the broadcast
channels, ICS event UIDs (`@next168.app`), environment variables (`NEXT168_*`), the companion's package, command,
MCP server name and config key, its session cookie, the local development CA's name, the repository, the
`package.json` name and the next168.app URLs. A chat AI may answer with a block labelled `next168` (prompts copied
before the rename); it is still read.
