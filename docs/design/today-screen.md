# Today ("Hoy") screen redesign (#3)

Author: senior product designer agent (Claude Opus 5.5), 2026-11-06. Design only; no code changes.
Inputs: the owner's request of 2026-11-07 ("it is the main screen; it must be clean, understandable, and one must know
what has to be done at that moment"), his screenshot (personal data, described generically only), the code on
`chore/#3-today-ux-design`@f77ebc0, `docs/design/visual-design.md`, and the `apple-design` (HIG pages
`layout.md`, `accessibility.md`, `color.md`, `progress-indicators.md`, `lists-and-tables.md`, `motion.md`) and
`apple-fluid-design` skills.

## Review round 1 resolution

Review: Codex, `/tmp/weeklid-today-rt/r1.md`, verdict ACCEPT WITH CHANGES on 29929a7. Coordinator decisions are
recorded as **decided** (D1–D6); the owner may veto any of them. "Family" is the class of defect checked beyond the
reported instance.

| # | Finding | Family checked | Resolution | Where |
|---|---|---|---|---|
| 1 | MAJOR: a task underway is missing from Now and Next | Anything happening now that is not a routine block: fixed-time task chunks, Weeklid events, calendar events, two overlapping blocks; and the same gap in "Next" (`nextUp` ignores events) and in "Libre" (gaps ignored busy events) | **D1 decided:** a task chunk spanning now is the primary Now item; its routine block is the context line. One priority rule (§5.1) picks Now from all kinds; Next and gaps use all kinds. (The round-1 claim that only fixed-time tasks can span now was wrong; corrected in row R2-1.) | §1, §5.1, §5, checks 17–19 |
| 2 | MAJOR: conflict state does not decide what to do | Every place the overlap shows: Now title, context line, Do slot, Next, list row text, both languages | **D2 decided:** a calendar or Weeklid event (a commitment with others) wins Now over a routine block; the routine shows as "Tu rutina: …" on the context line; no check-in asked about the event | §5.1, §5, §9, check 9 (es + en) |
| 3 | MAJOR: 30-minute window unproven and hides check-ins | Every element this redesign hides or moves that holds an answerable item: Now-card question, collapsed "Antes", evening Do slot, read-only tab; and the claim "only behaviour change" | **D3 decided:** 30 min is a hypothesis with a measure, source, baseline and review date (§5.2). After the window, unanswered items stay countable on the "Antes" row, which opens straight to them. The full list of behaviour changes replaces the "only change" claim | §5, §5.2, §5.3, §7, checks 6, 20 |
| 4 | MAJOR: VoiceOver behaviour asserted, not supported | Every accessibility claim in §10 that cites existing behaviour or adds new ARIA: announcer, progressbar `aria-valuetext`, `aria-expanded`/`aria-controls`, event row names, now-line text | **D4 decided:** false claim removed (the announcer only reads the page title on navigation, `AppShell.vue:137`). New block-change announcement specified with timing and duplicate suppression; `aria-valuetext` specified; each has a check | §1, §10, checks 3, 21, 22 |
| 5 | MINOR: "También ahora" uses a fixed article | Every Spanish string with "la/las {time}" in §9, the states table and wireframes | All such keys now carry "singular \| plural" forms and are rendered through `untilClock` (`clockPhrase.ts:10-12`); one check at 1:00 | §9, check 23 |
| 6 | MINOR: status-control visibility note wrong; event details "as Week does" do not exist on Today | Every "existing behaviour" claim in §1 and every new interactive element | §1 corrected (an answered block keeps its control mid-block, `NowCard.vue:48-50`). Event rows on Today stay non-interactive (D5 decided). DOM rule chosen: collapsed past rows are **not rendered** until expanded (§7), check 6 matches | §1, §7, §8, checks 6, 10 |
| — | Keep free-hours removal (reviewer agrees) | Other tests asserting removed or renamed text ("Tarde", subtitle) | **D6 decided:** removed from the header (Insights already shows it, `InsightsView.vue:87`). The implementation change updates `e2e/today-checkin.spec.ts:71` in the same PR, plus any spec asserting "Tarde" | §3, §12 note |

**Round 2** (Codex on 947e03c, `/tmp/weeklid-today-rt/r2.md`, ACCEPT WITH CHANGES):

| # | Finding | Family checked | Resolution | Where |
|---|---|---|---|---|
| R2-1 | MAJOR: floating tasks can already span now | Every statement that ties "can be Now" to a task type (§1, §5.1, round-1 row 1) | Claim removed: `scheduleStable` keeps a previous floating placement while its chunk ends after now (`scheduling.ts:151-167`), so any task kind can be underway; §5.1 rule 2 applies to every chunk spanning now. Today's caller passes no `previous` today (`TodayView.vue:58`); the rule does not depend on that | §1, §5.1, check 24 |
| R2-2 | MAJOR: a long timed event monopolises Now; equal ties have no meaning | Every rule that ranks items: event vs task/routine, event vs event, task vs task, block vs block; and what the context line shows in each case | **D7 decided (owner may veto):** a timed event wins Now only if it lasts ≤ 4 h; a longer one is context ("También ahora: …") and the task or routine stays primary (with nothing else spanning now, the long event is Now). Ties inside one rank: the shorter wins (more specific), then the later start, then key order; the runner-up is the context line | §5.1, §9, checks 25, 26 |
| R2-3 | MINOR: 14-day comparison is not strong evidence | Every claim in §5.2 that reads as proof | Called directional; counts reported next to the rate; the effect of plan edits on the denominator stated | §5.2 |
| R2-4 | MINOR: the announcement omits the new check-in action | Every moment the Do slot gains an action without a spoken cue: a Now boundary, the 10-minute mark | When the question becomes available it is announced once, combined with the Now change when both happen on one refresh; losing it is not announced | §9, §10, checks 22, 27 |
| R2-5 | MINOR: "Antes" focus jump fails in read-only | Every focus move onto a control that can be disabled | Focus stays on the "Antes" button when rings are disabled (`planner.writable` false) | §7, check 28 |

## 1. What the screen does today (code facts)

Order of the page (`src/features/today/TodayView.vue:112-155`): subtitle "date · N h libres esta semana" (`:51`),
assistant entry (`:113`), Google coverage notice (`:114`), Now card (`:121`), check-in card (`:135`), "Tu día"
timeline (`:136`), "Por hacer hoy" (`:154`).

- **Now card** (`NowCard.vue`): eyebrow "AHORA" (`:74`), block title (`:77`), range and "Quedan N min" (`:91-94`),
  6 px progress bar in the category colour (`:95-104`, `:135-136`), "Después <title> <time>" (`:107-114`). The
  status ring appears in the block's last 10 minutes, or at any time once the block already has an answer
  (`:48-50`, `statusWindow.ts:2,6-9`). With no current block
  the title reads "Tiempo libre hasta las {time}" (`:53-56`).
- **Current and next** come from blocks only (`src/core/now.ts:4-13`); calendar events never become "now".
  "Después" is the next block or placed task by start time (`nextUp.ts:6-11`), never an event; a task chunk already
  under way is in neither. Free time between the current item and the next one is not represented.
- **Task placement**: new floating placements start at the next five-minute step after now (`scheduling.ts:38-40`),
  but `scheduleStable` keeps a previous floating placement while its chunk ends after now (`scheduling.ts:151-167`),
  so a floating chunk can span now; fixed-time tasks (`at` + duration) are one interval at their time
  (`scheduling.ts:121-133`) and can too. Today currently calls `fitTasks` without `previous` (`TodayView.vue:58`).
- **Announcements**: the shell's polite live region (`src/ui/announcer.ts`) reads the page title after navigation
  (`AppShell.vue:137`). Today announces nothing when the current block changes.
- **Event rows** on Today have no press handler; event details exist only in Week (`DayColumn.vue`).
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

1. **Now** — what (title), for how long ("quedan 41 min", the largest number), until when; one context line when
   something else also spans now (§5.1).
2. **Do** — the single action that applies right now, as a labelled button, or nothing.
3. **Next** — what starts when this ends; a gap is a named item ("Libre hasta las 11:00 p. m.").
4. **Later today** — upcoming items only, with a now-line at the top.
5. **Earlier today** — one collapsed row with the count still to answer.
6. **To do today** — unchanged.

Removed: the week's free hours from the subtitle (D6, decided: Insights already shows the live figure,
`InsightsView.vue:87`), duplicate conflict lines, conflict lines on
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
| **Task underway** (D1: a task chunk spans now) | task title, "Quedan N" to the chunk's end, bar in the task's category colour; context line "En <routine> · hasta las T" when a routine block also spans now | "Marcar como hecha" tinted button (completes the task with the existing undo toast; Now then falls back by §5.1) | next item or gap after the chunk | the task row is the current row |
| **Ending** (last 10 min, or ended < 30 min ago and unanswered, still nothing else current; 30 = hypothesis, §5.2) | same, bar ≥ 83 % | "¿Cómo fue?" + Hecho / A medias / No | same | — |
| **Gap** (no block now) | eyebrow AHORA, title "Libre", "Quedan 2 h 30 min", "hasta las 11:00 p. m." (no bar) | the ended-block question if it applies, else empty | "Después 11:00 p. m. Sueño" (the time is said once) | gap row "Libre · 2 h 30 min" right under the now-line |
| **Late** (task chunk past due, `chunkIsLate`) | unchanged | — | — | badge "Atrasada" / "Overdue" (warning fill 18 %, text `--label`) |
| **Done** (no more items today except sleep, or the check-in window is open) | current item as usual | an Ending question first if one applies; otherwise "Cierre del día ›" tinted button when the check-in is not done (replaces the separate check-in card while it is in the slot; the card with its reminder toggle stays below otherwise) | "Mañana, 8:30 a. m. Traslado" | everything in "Antes" except sleep |
| **Nothing planned** (no content) | hidden; existing EmptyState (`TodayView.vue:115-119`) | — | — | — |
| **Free day** (plan exists, nothing today) | "Libre" + "Después <weekday>, T <title>" | — | — | existing emptyDay state |
| **Conflict** (D2: a calendar or Weeklid event overlaps a routine block now) | the **event** is Now: calendar glyph + title, its "Quedan N", "hasta las T", bar in `--label-2`; context line "Tu rutina: <block> · hasta las T" | empty (events are not checked in); a routine in its own Ending window still gets "¿Cómo fue <block>?" | first item of any kind starting after the event ends, or the gap | the *block* row carries "⚠ Se cruza con <event>" once, only while the pair is current or upcoming; the event row does not repeat it; past pairs show nothing |
| **Overnight** | a block that began yesterday is "now" until it ends (as today); its range reads "11:00 p. m. – 7:00 a. m." | — | — | yesterday's tail goes into "Antes"; tonight's block shows "Hasta las 7:00 a. m." (as today) |
| **Offline / Google unavailable** | unchanged, never moved down | — | — | the coverage notice moves from above the Now card to directly under the "Tu día" heading, same component and copy |
| **Read-only tab** (`planner.writable` false) | "Do" slot replaced by Footnote "Solo lectura en esta pestaña" / "Read-only in this tab"; rings disabled as today | | | the "Antes" count still shows, so nothing unanswered is hidden |

### 5.1 What is "Now" (D1, D2 decided; the owner may veto)

One rule picks the primary item from **every kind** that spans now (`start ≤ now < end`): blocks, placed task
chunks, Weeklid events, busy calendar events (all-day and free events never count).

1. A calendar or Weeklid event lasting **at most 4 h** wins (a commitment with other people; D7). A longer timed
   event (a trip, a conference day) does not outrank a task or routine.
2. Else a task chunk (the specific thing to do inside a broad routine), floating or fixed.
3. Else a routine block.
4. Else a timed event longer than 4 h.
5. Ties inside one rank: the shorter wins (the more specific commitment); then the later start; then the stable key
   order of `buildTimeline`.

The context line names the runner-up, at most one item, with "+N" for the rest: the routine under a task ("En
Trabajo · hasta las 5:00 p. m."), the routine displaced by an event ("Tu rutina: Ejercicio · hasta las 7:00 p. m."),
or a long event or a tied equal-rank item ("También ahora: Viaje · hasta las 9:00 p. m."). An event runner-up
outranks a routine runner-up for this line. **Next** is the earliest item of any kind starting at or after the primary item's end (events included,
replacing `nextUp`'s blocks-and-tasks rule); when nothing of any kind spans the time between, that time is a gap.
**Libre** means no item of any kind spans now.

### 5.2 The 30-minute Ending window is a hypothesis (D3 decided)

The Now card keeps asking for up to 30 minutes after a block ends (the list's ring rule, `statusWindow.ts:2,6-9`,
is unchanged). 30 is not settled:

- **Measure:** answer rate = answered occurrences / askable occurrences per day (`document.actuals` against
  askable `datedOccurrences`; askable per `planSince.ts`), computed locally from an export; no telemetry. Always report
  the two counts next to the rate ("31 / 44 = 70 %").
- **Denominator and plan edits:** askable occurrences are rebuilt from the plan in the export, and an export holds only
  the current plan; a routine edited or deleted mid-window changes its past occurrences (answers keep their own
  snapshot, `actuals.ts:19-30`). So take one export at the end of each window, count each window against its own
  export, and list any routine edits in the window next to the result.
- **Baseline:** the owner's 14 days before the release; **after:** the 14 days after it. With one person and two
  windows this is **directional**, not proof that the window caused a change.
- **Review date:** 14 days after release, and no later than 2026-12-18. Keep 30 if the rate rises; otherwise try 60 or
  drop the extension.
- **Never hidden after the window:** an unanswered item stays counted on the "Antes" row ("2 sin marcar"), which opens
  straight to the first unanswered ring (§7), and in the list's rings as today.

### 5.3 Behaviour changes (complete list; everything else is layout and copy)

1. Now picks from all kinds by §5.1 (today: blocks only, `now.ts:7`). 2. Next includes events; gaps are named.
3. The Now card's Ending window (+30 min, §5.2). 4. Do slot: task completion, the evening "Cierre del día" link.
5. Past rows collapse and are not rendered until expanded (§7). 6. A new spoken announcement when Now changes
(§10). 7. Unanswered rings are `--label-2`. 8. Copy changes (§9). 9. The Google notice moves below "Tu día".
10. The weekly free hours leave the header.

## 6. Check-ins (the circles)

- **Role:** a record of whether a planned block happened, feeding Summary. It is optional and never blocks anything.
- **Primary place:** the Now card's labelled buttons at the moment it is relevant. The list's ring stays for catching
  up later, inside "Antes", where the summary row says how many are unanswered ("2 sin marcar") and opens straight to
  them. Ring visibility rules are unchanged (`TodayTimeline.vue:82-89`).
- **Ring:** 24 px ring, 2 px, **`--label-2`** for unanswered on every row (no category colour: one colour, one
  meaning). Done = `--tint` disc with check (unchanged); partial / skipped shapes unchanged. 44 px button unchanged.
- **Interaction unchanged** (tap = Hecho, long press / right click / ↓ = menu), but the accessible name gains the
  question: "¿Cómo fue Trabajo? Sin marcar. Toca para marcar como hecho; mantén pulsado para más opciones".
- Calendar events never get a ring (they are not the person's plan). Tasks keep their checkbox.

## 7. Past items collapse

- All items whose end ≤ now (and yesterday's overnight tail) collapse into one first row of the "Tu día" card:
  "Antes · {n}" leading, "{k} sin marcar" trailing in `--tint-label` when k > 0, chevron `›` (`--label-3`, 20 px).
- Tap toggles inline expansion (chevron rotates 90°), `aria-expanded`; expanded rows are today's past rows exactly as
  now (greyed title), in time order, between the "Antes" row and the now-line. State is per visit; it starts collapsed.
- **DOM rule (one rule):** while collapsed, past rows are **not rendered** (no hidden copies, no `aria-controls` to an
  absent element). Expanding renders them. Upcoming rows are always rendered, in time order.
- **Opens straight to them:** when k > 0 and rings are enabled, expanding moves focus to the first unanswered ring and
  scrolls it into view (`block: 'nearest'`); when k = 0 or the rings are disabled (`planner.writable` false), focus
  stays on the "Antes" row. Collapsing returns focus to the "Antes" row.
- If no past items: the row is absent. If everything is past: the row stays collapsed and the now-line follows it.

## 8. Calendar events

- In the same chronological list (time order is what people need), but marked by **shape and word**, not colour:
  a 14 px Lucide `calendar` glyph before the title in `--label-2`, bar replaced by none (column left empty), title in
  `--label`, times as other rows. The visually hidden kind word becomes the source name: "Google Calendar" /
  "Calendario de Weeklid".
- No ring, and **not interactive** on Today (D5 decided: no press handler, no hover, no focus stop; details stay in
  Week, `DayColumn.vue`). Its text is read in the normal reading order.
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
| `today.now.taskContext` | En {title} · hasta la {time} \| En {title} · hasta las {time} | In {title} · until {time} |
| `today.now.routineContext` | Tu rutina: {title} · hasta la {time} \| Tu rutina: {title} · hasta las {time} | Your routine: {title} · until {time} |
| `today.now.more` | +{count} | +{count} |
| `today.now.completeTask` | Marcar como hecha | Mark as done |
| `today.now.changed` (spoken) | Ahora: {title}, hasta la {time} \| Ahora: {title}, hasta las {time} | Now: {title}, until {time} |
| `today.now.alsoNow` | También ahora: {title} · hasta la {time} \| También ahora: {title} · hasta las {time} | Also now: {title} · until {time} |
| `today.now.askAvailable` (spoken) | Puedes marcar cómo fue {title} | You can mark how {title} went |
| `today.now.closeDay` | Cierre del día | Day wrap-up |
| `today.now.readOnly` | Solo lectura en esta pestaña | Read-only in this tab |
| `today.timeline.earlier` | Antes · {count} | Earlier · {count} |
| `today.timeline.unanswered` | {count} sin marcar | {count} to mark |
| `today.timeline.nowLine` | Ahora {time} | Now {time} |
| `today.timeline.gap` | Libre · {duration} | Free · {duration} |
| `today.timeline.overlaps` | Se cruza con {titles} (unchanged; shown on the block row only) | Overlaps with {titles} |
| `today.timeline.late` | Atrasada | Overdue |
| `today.status.markDone` | ¿Cómo fue {title}? Sin marcar. Toca para marcar como hecho; mantén pulsado para más opciones | How did {title} go? Not marked. Tap to mark done; press and hold for more |

Existing "Quedan {duration}", "Hecho / A medias / No", "Después", empty states: unchanged. Every Spanish key with
"la/las {time}" above (`until`, `freeUntil`, `taskContext`, `routineContext`, `alsoNow`, `changed`) carries both forms and is
rendered with `untilClock(t, key, time)` (`clockPhrase.ts:10-12`), never `t(key, { time })`; the other languages ship
one form. The wireframes write "las 8:00" only because those hours are plural.

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
  hacer hoy". Event rows are plain text (not focusable).
- **Progressbar (new attributes):** keep `role="progressbar"` and `aria-valuenow` (`NowCard.vue:95-104`), add
  `aria-valuetext` = the visible "Quedan {duration}" string (`common.duration.left`), updated with it; the bar is
  absent in a gap.
- **Announcing a change of Now (new; today nothing does, see §1):** Today calls the existing `announce()`
  (`src/ui/announcer.ts`, polite, 300 ms debounce) with `today.now.changed` when the primary item's key (§5.1, "free"
  counts as a key) differs from the last key Today announced or rendered. Timing: on the first `useNow` refresh after
  the boundary. Not on first render (the shell already reads the page title, `AppShell.vue:137`); not while
  `document.visibilityState` is `hidden` (the key is recorded silently, so returning does not replay it); never for
  minute-count or context-line changes. Each boundary is announced exactly once, because the announcer
  itself re-reads identical messages (`announcer.ts:13-15`) and so cannot de-duplicate.
- **Announcing the check-in question:** when the Do slot's "¿Cómo fue?" becomes available for an occurrence it did not
  offer at the previous refresh (the 10-minute mark, or a boundary), Today announces `today.now.askAvailable` once per
  occurrence, under the same first-render and hidden-tab rules. If the Now key changes on the same refresh, one message
  carries both: "{changed}. {askAvailable}". The question going away is not announced.
- **Reduced motion / transparency / forced colours:** see Motion; forced-colors keeps the existing ring shapes.

## 11. Motion

- Expand/collapse "Antes": height spring, bounce 0, 0.35 s (`--spring-duration`), chevron rotate in the same spring.
- Do-slot appear/disappear and Now-card content change at a block boundary: 150 ms opacity cross-fade, no slide.
- Answer: ring fill 100 ms (existing). Progress bar: no transition; it jumps every 30 s refresh (existing rule,
  `visual-design.md` line 172).
- `prefers-reduced-motion: reduce`: expansion is a 150 ms opacity fade with instant height; no transforms.

## 12. Acceptance checks (executable)

Fixture: a synthetic document like `e2e/today-checkin.spec.ts:20-40` with blocks Sleep 23:00–07:00 daily, Commute
08:30–09:00, Work 09:00–17:00, Commute 17:00–17:30, Exercise 18:00–19:00, Side project 19:00–20:00 (Mon–Fri), Weeklid
events 17:30–18:30 and 12:30–13:00, a fixed-time task 10:00–10:45 due 2026-11-06 in Work's category, an older
check-in (so blocks are askable); `page.clock.install` on Friday 2026-11-06 (UTC), es and en, 375×812 and 1440×900,
light and dark. The same implementation PR updates `e2e/today-checkin.spec.ts:71` (subtitle without free hours, D6)
and any spec asserting "Tarde".

1. At 19:19 the first element after the h1 is the subtitle and it equals the formatted date only (no "libres").
2. The Now card is the next region; no Google notice precedes it in DOM order (also with the notice forced to
   `unavailable` offline).
3. At 19:19 `now-left` reads "Quedan 41 min" and a "hasta las 8:00 p. m." text is in the card; the progressbar's
   `aria-valuetext` equals the `now-left` text exactly (es "Quedan 41 min", en the `common.duration.left` string), and
   equals it again after advancing the clock 60 s; at 20:30 (gap) there is no progressbar.
4. At 19:19 the Next row reads "Después · 8:00 p. m. · Libre hasta las 11:00 p. m." (separators per `inlineSeparators`).
5. At 19:19 the Do slot is empty; at 19:53 and at 20:15 it contains three buttons named Hecho, A medias, No; at 20:31
   it is empty. Tapping Hecho records `done` for the 19:00 occurrence and shows the undo toast.
6. With the 08:30 Commute answered "done" and nothing else answered, at 19:19 the "Tu día" card's first row is a
   button "Antes · 8" (sleep tail, Commute, task, Work, two events, Commute, Exercise) with `aria-expanded="false"`, no
   `aria-controls`, and text "3 sin marcar" (Work, Commute, Exercise: past askable blocks without an answer; carry-over
   and events never count); no `timeline-item` ending at or before now exists in the DOM. After pressing it:
   `aria-expanded="true"`, the eight past rows exist in time order between it and the now-line, and
   `document.activeElement` is Work's ring. Pressing again removes them and focuses the button. At 21:00 (after the
   30-min window) the row reads "Antes · 9" and "4 sin marcar".
7. A now-line labelled "Ahora 7:19 p. m." follows the "Antes" row; the current row (19:00) directly follows it; a gap row
   "Libre · 3 h" sits between the 19:00 and 23:00 rows; no other row is above the now-line while collapsed.
8. Every unanswered ring's computed `border-color` equals `--label-2` for every category.
9. At 18:10, es: `now-title` is the 17:30 event with a calendar glyph, the card reads "hasta las 6:30 p. m." and the
   context line "Tu rutina: Ejercicio · hasta las 7:00 p. m."; the Do slot is empty. en: "until 6:30 PM" and "Your
   routine: Ejercicio · until 7:00 PM" (per the en clock format). The Exercise row carries exactly one "Se cruza con" /
   "Overlaps with" line; the event row has none. At 18:31 `now-title` is "Ejercicio". At 19:19 no overlap text is
   visible.
10. Event rows contain an `svg` calendar glyph and a visually hidden source name, no `status-control`, no element with
    a `tabindex`, `href`, `button` role or click handler; pressing one changes nothing (URL and focus unchanged).
11. A late task chunk shows "Atrasada" (es) / "Overdue" (en); the string "Tarde" never appears.
12. At 23:30 with no check-in today, the Do slot holds a link "Cierre del día" to `#/checkin`.
13. At 07:40 the card reads "Libre", "hasta las 8:30 a. m.", and "Después 8:30 a. m. Traslado": "8:30" appears at
    most twice in the card (status line and next row) and the sentence "Tiempo libre hasta" is gone.
14. Every interactive element in the page has a box ≥ 44 × 44 px; `e2e/support/visualIntegrity.ts` passes on all
    cases above; axe has no violations.
15. With `prefers-reduced-motion: reduce`, expanding "Antes" records no transform animation
    (`e2e/support/transformRecorder.ts`).
16. At 200 % text on 375 px no text is cut and the answer buttons stack one per line.
17. **Task underway (D1):** at 10:10, `now-title` is the task's title, the card reads "Quedan 35 min" and the context
    line "En Trabajo · hasta las 5:00 p. m." (en "In Trabajo · until 5:00 PM"); the Do slot has one button "Marcar
    como hecha". Pressing it marks the task done, shows the undo toast, and `now-title` becomes "Trabajo"; Undo
    restores the task as Now.
18. **Next includes events:** at 12:10, the Next row names the 12:30 event, not a later block or task.
19. **Gaps honour all kinds:** at 17:35 nothing reads "Libre" (the event spans now); at 20:30 the card title is "Libre".
20. **Ending window:** with 19:00–20:00 unanswered, the question is in the Do slot at 20:29 and gone at 20:31; the
    "Antes" row then counts it (check 6).
21. **Announcement:** load at 19:19 and wait 2 s: the live region holds only the page title. Set the clock to
    19:59:50 and advance through 20:01:30: the live region shows "Ahora: Libre, hasta las 11:00 p. m." exactly once
    (sample its text every 100 ms; count transitions into that value). With the page hidden
    (`visibilityState` emulated `hidden`) across 20:00, nothing is announced, and nothing is announced on return.
22. **No duplicate on refresh:** between 19:19 and 19:49 (several `useNow` refreshes) the live region never changes.
23. **la/las:** at 12:40 (es) the card reads "hasta la 1:00 p. m." and "Tu rutina: Trabajo · hasta las 5:00 p. m.";
    the text "las 1:00" appears nowhere on the page.
24. **Kept floating chunk (R2-1)**, unit test on the Now selector: a floating task (no `at`) whose kept placement
    (`previous`) chunk is 09:50–10:40 inside Work, `now` 10:10 → the primary item is that task and the context is Work.
    If the implementation makes Today pass `previous`, the same holds on screen ("Quedan 30 min").
25. **Long event (D7):** add a timed Weeklid event "Viaje" 06:00–21:00. At 11:00 (no task underway) `now-title` is
    "Trabajo" and the context line is "También ahora: Viaje · hasta las 9:00 p. m." (en "Also now: Viaje · until
    9:00 PM"); at 17:40 the 1-h event 17:30–18:30 is Now with the context "También ahora: Viaje …" (event runner-up
    first); at 20:30 (nothing else spans now) "Viaje" is Now.
26. **Tie (D7):** add a Weeklid event 17:30–18:00 beside the 17:30–18:30 one: at 17:40 the 30-min event is Now and the
    context line is "También ahora: <1-h event> · hasta las 6:30 p. m."; swapping their key order changes nothing.
27. **Check-in announcement (R2-4):** advance from 19:49:50 to 19:50:30: the live region shows "Puedes marcar cómo
    fue Proyecto personal" exactly once. Unit test on the announcement builder: a Now-key change and a new question on
    one refresh give one message "Ahora: …. Puedes marcar cómo fue …".
28. **Read-only focus (R2-5):** with `planner.writable` false, pressing "Antes" expands it and
    `document.activeElement` stays the "Antes" button.

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
  question? Is the §5.2 measure computable from an export and honest with one person's data?
- **§5.1 priority and the 4 h limit (D7)**: is 4 h the right line between a meeting and a trip? A 5-h workshop now
  ranks below a routine.
- **Focus jump on expanding "Antes"** (§7): helpful or disorienting for VoiceOver users?
- **Collapsing the past**: does hiding six rows behind "Antes" bury the catch-up answers Summary depends on? Measure
  answer rate before/after rather than assuming.
- **Removing "N h libres esta semana"** (D6, decided, owner may veto): the implementation PR must update
  `e2e/today-checkin.spec.ts:71` in the same change, not leave it failing.
- **Now-line in `--danger`**: familiar from Week, but red on the main screen may read as an alarm.
- **The Do slot taking over the check-in card in the evening**: one path or two to the same place?
- Anything in sections 4–11 that adds an element without removing confusion.
