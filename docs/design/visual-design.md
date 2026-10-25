# Next168 visual design direction (#3)

Author: MIA coordinator (Claude Opus 5.5), 2026-10-24. Sources: `apple-fluid-design` skill (emilkowalski/skills@2d22863), Apple HIG via the `apple-design` skill, screenshots of `main`@05d781d.

## What is wrong today (observed on main)

- A dark gradient hero takes 165 px on desktop and 250 px on a phone before any content. It says the tagline instead of the user's week.
- Emoji as navigation icons (📅 🏷️ 📊) and as stat-card icons; inconsistent sizes and baselines.
- Three competing accents: green active tab, blue add buttons, per-category colored top borders.
- The week is a stack of equal cards: a 1-hour gym block and a 4-hour work block look the same size, so the 168-hour idea is invisible.
- Mobile shows one day as tall cards; four blocks fill two screens.
- Modal confirm dialogs for destructive actions; no undo.
- No dark mode, no material, no motion system; the Vue devtools pill overlaps content in dev.

## Principles applied

Purpose and simplicity (one primary thing per screen), familiarity (iOS Calendar/Reminders/Health patterns), craft (system type scale, 8-pt grid, tabular numbers), fluid motion (interruptible springs, gestures with velocity), materials (translucent chrome only), forgiveness (undo instead of confirm), accessibility (reduced motion, reduced transparency, increased contrast, Dynamic Type via rem).

## Information architecture

| Tab | Purpose | Replaces |
|---|---|---|
| Today | "Now" card (current block, time left, progress, next), today's timeline with placed tasks, evening check-in entry | — (new, from prototype) |
| Week | Time-axis week grid (desktop: 7 columns; phone: day pager with swipe) | Calendar |
| Tasks | Inbox of tasks auto-fitted into free time of their category's blocks; overflow warnings | — (new) |
| Summary (Resumen) | 168-hour stacked bar, one row per goal, 7-day measures from the Day wrap-up | Statistics |
| Settings (gear, not a tab on phone) | Categories, language, data export/import, AI assistant, connect your LLM | Categories tab, language dropdown |

Phone: translucent bottom tab bar (4 tabs, SF-style line icons, label under icon), with the assistant (✦) and Settings (⚙) in the toolbar. From 768 px: a left sidebar with the same items and the assistant and Settings as footer rows; it can be hidden with ⌘\ / Ctrl+\ (an overlay with a scrim from 768 to 1023 px). Text and list screens use one centred 720 px column; Week uses the full width.

## Tokens

All colors as CSS custom properties on `:root`, redefined under `@media (prefers-color-scheme: dark)` and `[data-theme]`.

| Token | Light | Dark |
|---|---|---|
| `--bg` (grouped background) | #F2F2F7 | #000000 |
| `--surface` | #FFFFFF | #1C1C1E |
| `--surface-2` | #F2F2F7 | #2C2C2E |
| `--label` | #000000 | #FFFFFF |
| `--label-2` | rgba(60,60,67,.60) | rgba(235,235,245,.60) |
| `--label-3` | rgba(60,60,67,.30) | rgba(235,235,245,.30) |
| `--separator` | rgba(60,60,67,.29) | rgba(84,84,88,.65) |
| `--tint` (brand) | #5856D6 (indigo) | #5E5CE6 |
| `--danger` | #FF3B30 | #FF453A |
| `--success` | #34C759 | #30D158 |
| `--warning` | #FF9500 | #FF9F0A |

Category palette (user picks, stored as a key, not a hex): blue #007AFF/#0A84FF, green #34C759/#30D158, orange #FF9500/#FF9F0A, pink #FF2D55/#FF375F, purple #AF52DE/#BF5AF2, teal #30B0C7/#40C8E0, yellow #FFCC00/#FFD60A, red #FF3B30/#FF453A, gray #8E8E93/#98989D. Storing keys lets dark mode adapt; existing hex categories migrate to the nearest key.

Spacing: one scale, `--space-1` … `--space-12` (4, 8, 12, 16, 20, 24, 32, 40, 48 px, in rem), and the roles below. Radius: 10 (controls), 14 (cards), 22 (sheets). Shadows only on floating layers.

## Spacing

The owner's complaint (2026-10-24): screens felt stacked, with no air. The answer is not bigger everything but one set of roles, applied the same way on every screen. Components use the role tokens of `src/assets/tokens.css`, never a raw scale step or a px value for a job a role names.

| Role | Token | Phone | From 1024 px | Rule |
|---|---|---|---|---|
| Related controls | `--control-gap` | 8 | 8 | Controls side by side or stacked are either **joined** (at most 2 px, one compound control: a segmented track, the days of a routine, rows split by a hairline) or **at least 8 px apart**. Never in between. |
| Unrelated groups | `--group-gap` | 24 | 24 | Between groups inside one section or sheet (a field group and the next). |
| Page sections | `--section-gap` | 32 | 32 | Between consecutive page sections (`section`, list groups, cards that stand alone). None above the first one on a page. |
| Header to content | `--header-gap` | 16 | 16 | Under the large title (or the subtitle that belongs to it) before the first content. A section's own heading sits `--space-3` (12) above its card; an uppercase eyebrow `--space-2` (8). |
| Page gutter | `--page-gutter` | 16 | 16 | Between the screen (or sheet) edge and the content column. Fixed px. |
| Card inset (inline) | `--card-padding` | 16 | 20 | Text and visible controls keep this from a card's left and right edges, also in unpadded list cards whose rows supply the inset. Fixed px, like system margins: it does not grow with text size, so 200 % text keeps its width. |
| Card inset (block) | `--card-padding-block` | 16 | 20 | Top and bottom of content cards; grows with text. |
| Row padding | `--row-padding-block` | 12 | 12 | Above and below a list row's text; the smallest vertical inset any card content may have. |
| Row height | `--row-min-height` | 48 | 48 | Every list row is a full target, comfortable for a child's or an older hand. |

Vertical rhythm is in rem and grows with text; horizontal insets are px. Docked bars (the setup's answer dock, a sheet's action footer) keep at least `--space-4` (16) plus the safe area under their buttons; the undo toast floats `--space-3` above the tab bar and the page reserves room under it. A full-width row is the card's surface: its hit target may touch the card edges, its text may not.

On wide windows nothing else grows: the readable column stays 720 px, sections stay 32 px apart, and only the card insets go from 16 to 20 px.

Guarded in `e2e/support/visualIntegrity.ts` (self-tests in `e2e/visual-integrity.spec.ts`), on every audited screen: controls closer than `--control-gap` and not joined; text or a visible control closer to a card edge than `--card-padding` (inline) or `--row-padding-block` (block); page sections closer than `--section-gap`. The guard reads the tokens from the page, so it follows the width and the text size. Fix what it reports; do not loosen it.

## Typography

`font-family: system-ui, -apple-system, "SF Pro Text", "Segoe UI", Roboto, sans-serif`; no web fonts. Numbers use `font-variant-numeric: tabular-nums`.

| Style | Size/line | Weight | Tracking |
|---|---|---|---|
| Large title | 2.125rem/1.2 | 700 | -0.02em |
| Title 2 | 1.375rem/1.27 | 700 | -0.01em |
| Headline | 1.0625rem/1.3 | 600 | -0.01em |
| Body | 1.0625rem/1.35 | 400 | 0 |
| Subhead | 0.9375rem/1.33 | 400 | 0 |
| Footnote | 0.8125rem/1.38 | 400 | 0.005em |
| Caption | 0.75rem/1.33 | 500 | 0.01em |

Each screen opens with a large title ("Today", "Week") that collapses into the translucent toolbar on scroll.

## Materials

- Toolbar, tab bar and sidebar: `background: color-mix(in srgb, var(--surface) 86%, transparent); backdrop-filter: blur(30px) saturate(120%)`; content scrolls underneath; a scroll-edge fade replaces the hard 1 px divider and appears only when content is under the bar.
- Sheets: solid `--surface` with a dimming scrim (modal) and the page scaled to 0.96 behind on phone.
- Never glass on glass. `prefers-reduced-transparency: reduce` → solid surfaces; `prefers-contrast: more` → solid surfaces plus `--separator` borders at full opacity.

## Components

- **Now card:** large block title (Title 2), time range and "42 min left" in tabular numbers, a 6 px progress bar in the category color, "Next: …" row. Updates every 30 s without layout shift.
- **Status circle** (`src/features/today/ItemStatusControl.vue`, shared by Today, the Now card and the check-in): one trailing 44 px circle per item. A tap says Done and taps again to take it back; a long press, right click or arrow-down opens "Partly" and "No". It appears only when the question makes sense: a block's last ten minutes or after it ended, and always for tasks. Every answer shows a toast with Undo; the four states differ by shape (ring, disc with a check, half disc, ring with a dash), never by colour alone.
- **Week grid:** time axis 00–24 with 1 px hairlines every hour; blocks absolutely positioned by start/end, fill = category color at 16 % (light) / 28 % (dark), 3 px leading bar in full color, title Headline, time Footnote. Midnight-crossing blocks render on both days. Red now-line with dot. Tap a block → sheet anchored to it. Phone: one day per page, horizontal swipe with 1:1 tracking, velocity projection to the nearest day, rubber band at week ends; a segmented day strip on top.
- **Block/task editor:** bottom sheet on phone (drag handle, drag-to-dismiss with velocity handoff, detents medium/large), centered sheet on desktop scaling from the trigger. Inline validation (overlap, category cap) as the user types, never only on submit.
- **Lists (tasks, categories):** inset grouped lists like iOS Settings; swipe-left reveals Delete; delete shows an undo toast for 5 s instead of a confirm dialog.
- **Summary (Resumen):** three sections. "Your typical week": one stacked bar colored by category, gray for unassigned, headed "106 h assigned · 62 h unassigned" and one live line ("54 h free left this week"). "Your goals this week": one row per goal with one line in whole hours ("3 of at least 4 h · 1 h to go") and one ✓ or ! mark, plus what was done. "Last 7 days": named by its dates, with dot strips for sleep, exercise, late work, stress. Hours are whole numbers everywhere (a guard fails on `toFixed(` and on fractional-hour strings).
- **Buttons:** filled tint (primary), tinted 12 % (secondary), plain text (tertiary); 44 px minimum hit target; `:active` scale 0.97 within 100 ms on pointer-down.
- **Icons:** one inline SVG line-icon set (Lucide, MIT, tree-shaken) at 1.5 px stroke; emoji remain only as optional user-chosen category glyphs.

## Motion

- Library: `motion` (vanilla `animate`, spring support, velocity) for gesture-driven elements only; CSS transitions for hover/press/color.
- Default spring: bounce 0, duration 0.35 s. After a flick (sheet dismiss, day swipe): bounce 0.15–0.2 with the release velocity.
- Tab switch: 150 ms cross-fade, no slide. Sheets enter and exit along the same path. Now-line and progress bars do not animate continuously.
- `prefers-reduced-motion: reduce`: replace all springs/slides with 150 ms opacity fades; keep instant press feedback as color, not scale.

## Empty states and onboarding (for everyone, not only the owner)

First run: "Plan your 168 hours" with three steps (pick categories from templates such as Sleep, Work, Exercise, Learning, Family, Free time — each with a suggested min/max — set your typical week, add your first task). Skippable; no hard-coded personal categories. Every empty list has one sentence and one action.

## Acceptance for the visual slice

1. Screenshots at 390×844 and 1440×900, light and dark, for Today, Week, Tasks, Summary, Settings and the routine sheet, compared side by side with `main`.
2. Lighthouse accessibility ≥ 95 on Today and Week; all text contrast ≥ 4.5:1 (3:1 for ≥ 18.66 px bold) in both themes.
3. With `prefers-reduced-motion: reduce` emulated, no transform animation runs (checked in Playwright).
4. With `prefers-reduced-transparency: reduce` emulated, chrome has no `backdrop-filter`.
5. Sheet drag: release with downward velocity > 500 px/s dismisses even from a small offset; slow release under 40 % height snaps back.
6. Day pager: swipe tracks 1:1 and a flick advances one day.
