# Today ("Hoy") screen redesign (#3)

Author: senior product designer agent (Claude Opus 5.5), 2026-11-06. Design only; no code changes.
Inputs: the owner's request of 2026-11-07 ("it is the main screen; it must be clean, understandable, and one must know
what has to be done at that moment"), his screenshot (personal data, described generically only), the code on
`chore/#3-today-ux-design`@f77ebc0, `docs/design/visual-design.md`, and the `apple-design` (HIG pages
`layout.md`, `accessibility.md`, `color.md`, `progress-indicators.md`, `lists-and-tables.md`, `motion.md`) and
`apple-fluid-design` skills.

## 1. What the screen does today (code facts)

Order of the page (`src/features/today/TodayView.vue:112-155`): subtitle "date · N h libres esta semana" (`:51`),
assistant entry (`:113`), Google coverage notice (`:114`), Now card (`:121`), check-in card (`:135`), "Tu día"
timeline (`:136`), "Por hacer hoy" (`:154`).

- **Now card** (`NowCard.vue`): eyebrow "AHORA" (`:74`), block title (`:77`), range and "Quedan N min" (`:91-94`),
  6 px progress bar in the category colour (`:95-104`, `:135-136`), "Después <title> <time>" (`:107-114`). The
  status ring appears only in the block's last 10 minutes (`:50`, `statusWindow.ts:2,6-9`). With no current block
  the title reads "Tiempo libre hasta las {time}" (`:53-56`).
- **Current and next** come from blocks only (`src/core/now.ts:4-13`); calendar events never become "now".
  "Después" is the next block or placed task by start time (`nextUp.ts:6-11`); free time between the current item
  and the next one is not represented.
- **Timeline** (`TodayTimeline.vue`): every item of the day in one list, past included. A past item only greys its
  title (`:71-73`, `:182`); its times keep full `--label`. The current item has no marker; `currentKey` only hides
  its ring (`:83`). Last night's overnight block is a one-line "carry-over" (`:59-61`, `:115-121`).
- **The circles** are `ItemStatusControl` (`ItemStatusControl.vue`): a 44 px button with a 24 px ring
  (`:262-283`) coloured by the item's category (`:274`, via `TodayTimeline.vue:40-42`). Tap = "Hecho" at once
  (`:115-126`); "A medias" / "No" only by long press, right click or arrow-down (`:84-113`); the hint is a `title`
  tooltip (`:204`), invisible on touch. Shown on blocks after they end or in their last 10 min, and always on tasks
  (`TodayTimeline.vue:82-89`); never on calendar events.
- **Conflicts**: every overlapping block/event pair names the other on both rows (`todayTimeline.ts:26-43`,
  `TodayTimeline.vue:92-94,139`), past or not, as a plain footnote.
- **Calendar events** differ only by a 2 px dashed bar (`TodayTimeline.vue:181`) and a visually hidden kind word
  (`:130`); Weeklid events and Google events look the same.
- **Late tasks** get a badge "Tarde" (`TodayTimeline.vue:131`, `src/i18n/es/today.json:22`).
- **Check-in card** appears from 20:00 to 04:00 or once done (`checkin/evening.ts:6,10,23-26`).

## 2. Audit (ranked)

Evidence: synthetic screenshots in `/tmp/weeklid-today-ux-shots/` (outside the repo): `before-now-{375,768,1440}-{light,dark}.png`
at Friday 19:19, and at 375 light `before-gap`, `before-morning-carryover`, `before-conflict-now`,
`before-last-minutes`, `before-day-done`, `before-no-plan`. (The tab bar drawn mid-page in full-page captures is a
capture artifact of the fixed bar. The fixture uses a Weeklid event in place of a Google event; both render through
the same `is-event`/`is-external` styles.)

1. **No answer to "what do I do now".** During a block the only action on screen is a set of unlabelled rings
   about the *past* (4 of them in `before-now-375-light`). The Now card offers an action only in the last 10 minutes,
   as one more unlabelled ring (`before-last-minutes`). HIG `layout.md › Visual hierarchy`: "place the most
   important items near the top".
2. **Past, now and next look alike.** At 19:19 six of eight rows are over, they fill the first screen, and the one
   upcoming item (tonight's sleep) is below the 812 px fold at 375. Past rows differ only by a greyer title; there is
   no "now" position in the list (Week has a red now-line, `DayColumn.vue:467-475`; Today does not).
3. **The circles mean nothing visible.** No label, no header, colour = category (blue, gray, green, orange in one
   column) although the ring is a state control; alternatives hidden behind long press. `color.md`: "Avoid relying
   solely on color to … communicate essential information." The owner literally asked "check-ins?".
4. **Gaps are invisible.** Card says "Después: Sueño 11:00 p. m." while the block ends at 8:00; three free hours
   are not shown anywhere (`nextUp.ts`). In the morning gap the time is said twice: "Tiempo libre hasta las 8:30" and
   "Después Traslado 8:30" (`before-morning-carryover`).
5. **Conflicts are noise when past and missing when current.** Both rows repeat the same sentence, also for past
   pairs; during an overlap the Now card shows only the block (`now.ts:7`), so the calendar commitment you are
   actually in is not "now" (`before-conflict-now`).
6. **Calendar events are not identifiable.** A 2 px dashed bar is the only visible difference; no source glyph.
7. **Density in the header.** "· 32 h libres esta semana" is a week metric on a "now" screen; the Google notice is
   placed above the Now card (`TodayView.vue:114`), pushing the job of the screen down when offline.
8. **"Tarde" is ambiguous in Spanish** (late / afternoon) on a time-of-day list.
9. **Day finished** (`before-day-done`): 4 unanswered rings, no summary of the day; the real next action (Cierre
   del día) is a separate card under "Ahora: Sueño · Después: Sueño mañana".
10. **No plan / free day** states are already good (`before-no-plan`): one sentence and one action. Keep them.

What works and must survive: the Now card itself (title, time left, determinate progress, `progress-indicators.md
› Best practices`), tabular numbers, undo toast instead of confirmations (`useBlockStatus.ts`), whole-word wrapping,
44 px targets, forced-colors shapes for answers (`ItemStatusControl.vue:328-336`), 720 px column on wide windows.

## 3. Information hierarchy

One question per level, read top to bottom:

1. **Now** — what (title), for how long ("quedan 41 min", the largest number), until when.
2. **Do** — the single action that applies right now, as a labelled button, or nothing.
3. **Next** — what starts when this ends; a gap is a named item ("Libre hasta las 11:00 p. m.").
4. **Later today** — upcoming items only, with a now-line at the top.
5. **Earlier today** — one collapsed row with the count still to answer.
6. **To do today** — unchanged.

Removed: the week's free hours from the subtitle (it lives in Summary), duplicate conflict lines, conflict lines on
past items, category colour on rings, the Google notice above the Now card.

## 4. Wireframes

### 375 px, block in progress (19:19)

```
 Hoy                                   [✦] [⚙]
 viernes, 6 de noviembre

 ┌───────────────────────────────────────────┐
 │ AHORA                                     │
 │ Proyecto personal                         │  Title 2
 │ Quedan 41 min          hasta las 8:00 p. m.│  Headline / Subhead
 │ ███████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │  6 px
 │───────────────────────────────────────────│
 │ Después  8:00 p. m.  Libre hasta las 11:00│
 └───────────────────────────────────────────┘

 Tu día
 ┌───────────────────────────────────────────┐
 │ Antes · 6               2 sin marcar   ›  │  collapsed past
 │━━ Ahora 7:19 p. m. ━━━━━━━━━━━━━━━━━━━━━━│  now-line
 │ 7:00 p. m. ▌ Proyecto personal            │  current, Headline
 │ 8:00 p. m. ▌                              │
 │      Libre · 3 h                          │  gap, Footnote
 │ 11:00 p. m.▌ Sueño                        │
 │            ▌ Hasta las 7:00 a. m.         │
 └───────────────────────────────────────────┘

 POR HACER HOY
 ┌───────────────────────────────────────────┐
 │ +  Añadir para hoy                        │
 └───────────────────────────────────────────┘
```

### 375 px, last 10 minutes or just ended (19:53)

```
 │ AHORA                                     │
 │ Proyecto personal                         │
 │ Quedan 7 min           hasta las 8:00 p. m.│
 │ ████████████████████████████████████░░░░ │
 │ ¿Cómo fue?                                │  Footnote, --label-2
 │ [  Hecho  ] [ A medias ] [   No   ]       │  44 px, joined 8 px apart
 │───────────────────────────────────────────│
 │ Después  8:00 p. m.  Libre hasta las 11:00│
```

After an answer the buttons give way to one line: "✓ Hecho · Cambiar" (Undo toast as today).

### 1440 px (sidebar shown, 720 px column centred in the content area)

```
 ┃ sidebar ┃        Hoy
 ┃ Hoy     ┃        viernes, 6 de noviembre
 ┃ Semana  ┃        ┌──────────────────────────────── 720 ──────────────────────────────┐
 ┃ Tareas  ┃        │ AHORA                                                             │
 ┃ Resumen ┃        │ Proyecto personal                                                 │
 ┃         ┃        │ Quedan 41 min                              hasta las 8:00 p. m.    │
 ┃         ┃        │ ████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░ │
 ┃         ┃        │ Después  8:00 p. m.  Libre hasta las 11:00 p. m.                  │
 ┃         ┃        └───────────────────────────────────────────────────────────────────┘
 ┃         ┃        Tu día
 ┃         ┃        │ Antes · 6                                     2 sin marcar   ›    │
 ┃         ┃        │━━ Ahora 7:19 p. m. ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━│
 ┃         ┃        │ …same rows as 375…                                                │
```

No second column: the screen has one job and the readable column stays 720 px (`visual-design.md` line 29, 86).

## 5. States

| State | Now card | "Do" slot | Next row | List |
|---|---|---|---|---|
| **Now** (block in progress, > 10 min left) | title, "Quedan N", "hasta las T", bar | empty | next item or gap | now-line above current row |
| **Ending** (last 10 min, or ended < 30 min ago and unanswered, still nothing else current) | same, bar ≥ 83 % | "¿Cómo fue?" + Hecho / A medias / No | same | — |
| **Gap** (no block now) | eyebrow AHORA, title "Libre", "Quedan 2 h 30 min", "hasta las 11:00 p. m." (no bar) | the ended-block question if it applies, else empty | "Después 11:00 p. m. Sueño" (the time is said once) | gap row "Libre · 2 h 30 min" right under the now-line |
| **Late** (task chunk past due, `chunkIsLate`) | unchanged | — | — | badge "Atrasada" / "Overdue" (warning fill 18 %, text `--label`) |
| **Done** (no more items today except sleep, or the check-in window is open) | current item as usual | "Cierre del día ›" tinted button when the check-in is not done (replaces the separate check-in card while it is in the slot; the card with its reminder toggle stays below otherwise) | "Mañana, 8:30 a. m. Traslado" | everything in "Antes" except sleep |
| **Nothing planned** (no content) | hidden; existing EmptyState (`TodayView.vue:115-119`) | — | — | — |
| **Free day** (plan exists, nothing today) | "Libre" + "Después <weekday>, T <title>" | — | — | existing emptyDay state |
| **Conflict** (a calendar event overlaps the current block) | extra Footnote line under the title: "[calendar glyph] También ahora: <event> · hasta las T" | — | — | the *block* row carries "⚠ Se cruza con <event>" once, only while the pair is current or upcoming; the event row does not repeat it; past pairs show nothing |
| **Overnight** | a block that began yesterday is "now" until it ends (as today); its range reads "11:00 p. m. – 7:00 a. m." | — | — | yesterday's tail goes into "Antes"; tonight's block shows "Hasta las 7:00 a. m." (as today) |
| **Offline / Google unavailable** | unchanged, never moved down | — | — | the coverage notice moves from above the Now card to directly under the "Tu día" heading, same component and copy |
| **Read-only tab** (`planner.writable` false) | "Do" slot replaced by Footnote "Solo lectura en esta pestaña" / "Read-only in this tab"; rings disabled as today | | | |

The "Ending" window extends the existing 10-minute rule (`statusWindow.ts:2`) by up to 30 minutes after the end
*only for the Now card* while no other block is current, so the question is still there when the person looks up
right after finishing. This is the one behaviour change; everything else is layout and copy.

## 6. Check-ins (the circles)

- **Role:** a record of whether a planned block happened, feeding Summary. It is optional and never blocks anything.
- **Primary place:** the Now card's labelled buttons at the moment it is relevant. The list's ring stays for catching
  up later, inside "Antes", where the summary row says how many are unanswered ("2 sin marcar").
- **Ring:** 24 px ring, 2 px, **`--label-2`** for unanswered on every row (no category colour: one colour, one
  meaning). Done = `--tint` disc with check (unchanged); partial / skipped shapes unchanged. 44 px button unchanged.
- **Interaction unchanged** (tap = Hecho, long press / right click / ↓ = menu), but the accessible name gains the
  question: "¿Cómo fue Trabajo? Sin marcar. Toca para marcar como hecho; mantén pulsado para más opciones".
- Calendar events never get a ring (they are not the person's plan). Tasks keep their checkbox.

## 7. Past items collapse

- All items whose end ≤ now (and yesterday's overnight tail) collapse into one first row of the "Tu día" card:
  "Antes · {n}" leading, "{k} sin marcar" trailing in `--tint-label` when k > 0, chevron `›` (`--label-3`, 20 px).
- Tap toggles inline expansion (chevron rotates 90°), `aria-expanded`; expanded rows are today's past rows exactly as
  now (greyed title). State is per visit; it starts collapsed. Nothing is removed from the DOM order otherwise.
- If no past items: the row is absent. If everything is past: the row stays collapsed and the now-line follows it.

## 8. Calendar events

- In the same chronological list (time order is what people need), but marked by **shape and word**, not colour:
  a 14 px Lucide `calendar` glyph before the title in `--label-2`, bar replaced by none (column left empty), title in
  `--label`, times as other rows. The visually hidden kind word becomes the source name: "Google Calendar" /
  "Calendario de Weeklid".
- No ring. Tapping the row opens the existing event details (as Week does).
- All-day items stay as chips above the list (`TodayTimeline.vue:100-104`).

## 9. Microcopy (es / en)

| Key (new or changed) | es | en |
|---|---|---|
| `today.header.subtitle` | `{date}` | `{date}` |
| `today.now.until` | Hasta la {time} \| Hasta las {time} | Until {time} |
| `today.now.free` (title in a gap) | Libre | Free |
| `today.now.freeUntil` (next row, gap) | Libre hasta la {time} \| Libre hasta las {time} | Free until {time} |
| `today.now.ask` | ¿Cómo fue? | How did it go? |
| `today.now.answered` | {status} · Cambiar | {status} · Change |
| `today.now.alsoNow` | También ahora: {title} · hasta las {time} | Also now: {title} · until {time} |
| `today.now.closeDay` | Cierre del día | Day wrap-up |
| `today.now.readOnly` | Solo lectura en esta pestaña | Read-only in this tab |
| `today.timeline.earlier` | Antes · {count} | Earlier · {count} |
| `today.timeline.unanswered` | {count} sin marcar | {count} to mark |
| `today.timeline.nowLine` | Ahora {time} | Now {time} |
| `today.timeline.gap` | Libre · {duration} | Free · {duration} |
| `today.timeline.overlaps` | Se cruza con {titles} (unchanged; shown on the block row only) | Overlaps with {titles} |
| `today.timeline.late` | Atrasada | Overdue |
| `today.status.markDone` | ¿Cómo fue {title}? Sin marcar. Toca para marcar como hecho; mantén pulsado para más opciones | How did {title} go? Not marked. Tap to mark done; press and hold for more |

Existing "Quedan {duration}", "Hecho / A medias / No", "Después", empty states: unchanged. Use the plural article rule
already in `clockPhrase.ts` for every "la/las {time}".

## 10. Accessibility

- **Targets:** every button 44 × 44 px (`--tap-target`); the "Antes" row and gap-free rows ≥ 48 px
  (`--row-min-height`); answer buttons ≥ 8 px apart (`--control-gap`).
- **Contrast** (computed from tokens): `--label-2` light ≈ #6D6D72 on #FFFFFF ≈ 5.1:1; dark ≈ #98989F on
  #1C1C1E ≈ 5.9:1; `--tint-label` light on white ≈ 6.6:1, dark #5AD394 on #1C1C1E ≈ 9:1. Unanswered ring in
  `--label-2` ≥ 3:1 (non-text). The now-line is decorative; its label uses `--danger-label` (the implementer adds it to the
  existing `src/ui/*.contrast.spec.ts` checks at ≥ 4.5:1 on `--surface` in both themes).
- **Not by colour alone:** state = shape (ring/disc/half/dash), calendar = glyph + word, conflict = ⚠ + words,
  current = position below the now-line + Headline weight.
- **Large text (200 %):** the existing container query (`TodayTimeline.vue:196-206`) moves times above titles; the Now
  card's "Quedan" and "hasta las" wrap to two lines; answer buttons wrap to one per line, full width.
- **VoiceOver / reading order:** h1 Hoy → date → region "Ahora" (title, "Quedan 41 min, hasta las 8:00 p. m.",
  progressbar with `aria-valuetext` "Quedan 41 min", the Do slot, "Después …") → check-in card → "Tu día" heading →
  "Antes · 6, 2 sin marcar" button (expanded/collapsed) → "Ahora 7:19 p. m." (plain text) → upcoming rows → "Por
  hacer hoy". No live region announces the minute count; the block change is announced once through the existing
  `LiveAnnouncer` ("Ahora: Sueño").
- **Reduced motion / transparency / forced colours:** see Motion; forced-colors keeps the existing ring shapes.

## 11. Motion

- Expand/collapse "Antes": height spring, bounce 0, 0.35 s (`--spring-duration`), chevron rotate in the same spring.
- Do-slot appear/disappear and Now-card content change at a block boundary: 150 ms opacity cross-fade, no slide.
- Answer: ring fill 100 ms (existing). Progress bar: no transition; it jumps every 30 s refresh (existing rule,
  `visual-design.md` line 172).
- `prefers-reduced-motion: reduce`: expansion is a 150 ms opacity fade with instant height; no transforms.

## 12. Acceptance checks (executable)

Fixture: a synthetic document like `e2e/today-checkin.spec.ts:20-40` with blocks Sleep 23:00–07:00 daily, Commute
08:30–09:00, Work 09:00–17:00, Commute 17:00–17:30, Exercise 18:00–19:00, Side project 19:00–20:00 (Mon–Fri), one
event 17:30–18:30, an older check-in (so blocks are askable); `page.clock.install` on Friday 2026-11-06 (UTC), es and
en, 375×812 and 1440×900, light and dark.

1. At 19:19 the first element after the h1 is the subtitle and it equals the formatted date only (no "libres").
2. The Now card is the next region; no Google notice precedes it in DOM order (also with the notice forced to
   `unavailable` offline).
3. At 19:19 `now-left` reads "Quedan 41 min" and a "hasta las 8:00 p. m." text is in the card; the progressbar has
   `aria-valuetext` containing "41".
4. At 19:19 the Next row reads "Después · 8:00 p. m. · Libre hasta las 11:00 p. m." (separators per `inlineSeparators`).
5. At 19:19 the Do slot is empty; at 19:53 and at 20:15 it contains three buttons named Hecho, A medias, No; at 20:31
   it is empty. Tapping Hecho records `done` for the 19:00 occurrence and shows the undo toast.
6. At 19:19 the "Tu día" card's first row is a button "Antes · 6" with `aria-expanded="false"` and text "2 sin
   marcar" when two past blocks are unanswered; past rows are not rendered until it is pressed.
7. A now-line labelled "Ahora 7:19 p. m." is the second row; the current row (19:00) directly follows it; a gap row
   "Libre · 3 h" sits between the 19:00 and 23:00 rows; no other row is above the now-line while collapsed.
8. Every unanswered ring's computed `border-color` equals `--label-2` for every category.
9. At 18:10 the Now card has a line "También ahora: <event> · hasta las 6:30 p. m."; the block row carries exactly one
   "Se cruza con" line; the event row has none. At 19:19 no "Se cruza con" text is visible.
10. Event rows contain an `svg` calendar glyph, no `status-control`, and an accessible name starting with the source.
11. A late task chunk shows "Atrasada" (es) / "Overdue" (en); the string "Tarde" never appears.
12. At 23:30 with no check-in today, the Do slot holds a link "Cierre del día" to `#/checkin`.
13. At 07:40 the card reads "Libre", "hasta las 8:30 a. m.", and "Después 8:30 a. m. Traslado": "8:30" appears at
    most twice in the card (status line and next row) and the sentence "Tiempo libre hasta" is gone.
14. Every interactive element in the page has a box ≥ 44 × 44 px; `e2e/support/visualIntegrity.ts` passes on all
    cases above; axe has no violations.
15. With `prefers-reduced-motion: reduce`, expanding "Antes" records no transform animation
    (`e2e/support/transformRecorder.ts`).
16. At 200 % text on 375 px no text is cut and the answer buttons stack one per line.

### Pixel-perfect checklist (audit at 2x)

| Element | Value |
|---|---|
| Page gutter / card inset | 16 px / 16 px (20 px from 1024 px) — `--page-gutter`, `--card-padding` |
| Header → Now card | 16 px (`--header-gap`); subtitle Subhead 15/1.33, 400, `--label-2` |
| Now card | `--surface`, radius 14 (`--radius-card`), padding block 16 (20 ≥ 1024), internal gap 8 (`--space-2`) |
| Eyebrow "AHORA" | Footnote 13 px, 600, uppercase, tracking 0.02em, `--label-2` |
| Now title | Title 2, 22 px / 1.27, 700, −0.01em, `--label` |
| "Quedan 41 min" | Headline 17 px, 600, tabular, `--label`; "hasta las …" Subhead 15 px, 400, `--label-2`, same baseline |
| Progress | 6 px tall, radius 3, fill = category colour, track = 20 % category on `--surface-2` (unchanged) |
| "¿Cómo fue?" | Footnote 13 px, `--label-2`, 8 px above buttons |
| Answer buttons | 44 px min height, radius 10 (`--radius-control`), 8 px apart; Hecho = tinted (12 % `--tint`, text `--tint-label`), others plain |
| Next row | 8 px top padding, 0.5 px `--separator` top border, Subhead 15 px; label `--label-2`, time tabular `--label-2`, title 600 `--label` |
| Section heading "Tu día" | Headline 17 px 600, 12 px above its card (`--space-3`), 32 px below Now/check-in card (`--section-gap`) |
| "Antes" row | min 48 px, padding 12/16, Body 17 px `--label`; "2 sin marcar" Subhead 15 px `--tint-label`; chevron 20 px `--label-3` |
| Now-line | 2 px, `--danger`, full card width inside insets; label Caption 12 px 500 `--danger-label`, 4 px above line |
| Timeline row | grid 72 px (4.5rem) / 3 px / 1fr / 44 px, gap 12, padding 12/16, min 48 px; start Footnote 13 `--label`, end Footnote 13 `--label-2` |
| Current row | title Headline 17 px 600 `--label` (others Body 17 px 400) |
| Gap row | Footnote 13 px `--label-2`, padding 12/16, aligned to the title column, no bar, no separator above or below |
| Calendar glyph | 14 px, stroke 1.5, `--label-2`, 4 px before title; no bar |
| Ring | 24 px, 2 px border `--label-2`; done disc `--tint` with 14 px check `--tint-text` |
| Late badge | Caption 12 px 500, padding 1/8, pill, fill `--warning` 18 %, text `--label` |
| Sections | 32 px apart; nothing else new |

## 13. What the reviewer should attack

- **The 30-minute "Ending" extension**: does it ask about a block the person skipped, or race the next block's own
  question? Is 30 the right number, and is it the only behaviour change?
- **Collapsing the past**: does hiding six rows behind "Antes" bury the catch-up answers Summary depends on? Measure
  answer rate before/after rather than assuming.
- **Removing "N h libres esta semana"**: the owner may rely on it; it is covered by `e2e/today-checkin.spec.ts`
  ("the subtitle says the date and the free hours"), which this redesign deliberately changes.
- **Now-line in `--danger`**: familiar from Week, but red on the main screen may read as an alarm.
- **Calendar event as "también ahora"** instead of making it the current item: right for a person whose calendar
  wins over their routine?
- **The Do slot taking over the check-in card in the evening**: one path or two to the same place?
- Anything in sections 4–11 that adds an element without removing confusion.
