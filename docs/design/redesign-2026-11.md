# Minimalist redesign "una pregunta a la vez": implementation plan (#3)

Source of truth: the design direction `DIRECTION.md`, its review `REVIEW.md` and the `R_*` boards (canvas
https://claude.ai/artifact/56ho5rZV7S96pQHQXrwTUT, 2026-11-20). This file maps every board to the code that renders it,
lists the slices (one pull request each) and flags where the direction meets real app behaviour. Owner decisions kept:
"2 elegidas · una pregunta corta por cada una" in setup and soft-green selected day chips.

## Slices

Each slice is one pull request to `main`, built on the previous slice while that one is open (a later pull request
carries the earlier commits until they merge). `main` deploys on merge, so every slice leaves the whole app coherent:
a screen not yet redesigned keeps working with the new tokens and shell.

| # | Slice | Boards | Main files |
| --- | --- | --- | --- |
| 1 | Tokens, base components, app shell | RedisenoPrincipios (tokens, buttons, tab bar), shell of R_Hoy, R_TabletHoy, R_EscritorioHoy, R_MenuAnadir, R_TabletMenuAnadir, R_EscritorioMenuAnadir | `src/assets/tokens.css`, `src/assets/base.css`, `src/ui/Button.vue`, `src/ui/SegmentedControl.vue`, `src/ui/LargeTitle.vue`, `src/ui/ListGroup.vue`, `src/app/AppShell.vue`, `src/app/contracts.ts`, new `src/features/add/` (the one "+": menu + task/event sheets + routine conversation), `src/features/week/WeekView.vue` (its FAB and toolbar "+" go) |
| 2 | Hoy, Hoy vacío, Cierre | R_Hoy, R_HoyVacio, R_Cierre, R_TabletHoy, R_EscritorioHoy | `src/features/today/*` (NowCard → Ahora hero, TodayTimeline, TodayTodo), `src/ui/EmptyState.vue` (168 bar), `src/features/checkin/*` (form → conversation reusing `checkInForm.ts`) |
| 3 | Semana día/semana | R_Semana, R_SemanaCompleta, R_TabletSemana, R_EscritorioSemana | `src/features/week/*` (WeekNav segmented "Día · Semana", day strip, block style, today green) |
| 4 | Tareas, Nueva tarea, menú añadir | R_Tareas, R_HojaTarea, R_TabletTareas, R_EscritorioTareas | `src/features/tasks/*` (capture moves into the sheet title, warning summary row, "Hechas recientemente" disclosure) |
| 5 | Resumen | R_Resumen, R_EscritorioResumen | `src/features/insights/*`, `src/features/share/ShareWeekButton.vue` |
| 6 | Setup (7 parts) and routine edit/new as conversation | R_InicioSueno … R_InicioResumen, R_InicioDesplazamiento, R_InicioEjercicio, R_EditarRutina, R_NuevaRutina | `src/features/onboarding/setup/*` (progress bar, answer bubbles, multi-select "¿A qué más…?", "Siguiente"), `reopen.ts` (edit mode), Week block tap → edit conversation, "Editar todo" → `BlockEditorSheet` |
| 7 | Asistente, Propuesta, Ajustes | R_Asistente, R_Propuesta, R_Ajustes, R_TabletAjustes | `src/features/assistant/*`, `src/features/proposals/ProposalReviewSheet.vue`, `src/features/settings/*`, `src/app/settings/PreferencesSettings.vue` |
| 8 | Tablet and desktop leftovers | anything slices 1–7 did not cover | as needed |

## Where the direction meets real behaviour

1. **Page background.** The direction makes `--bg` white and adds `--bg-grouped` (the old grey). Screens built of
   white cards on grey (Settings, sheets, and every screen not yet redesigned) would lose their grouping on white. The
   shell paints the page with `--bg-grouped` unless the current view declares a plain backdrop; each slice switches its
   screens to plain as it removes their cards. When slice 7 lands every tab is plain and only grouped screens keep grey.
2. **One "+".** Week's FAB and its toolbar "+" become the shell's "+" (phone: round button beside the floating tab bar;
   tablet: 44 px circle at the end of the toolbar; desktop: "Añadir" in the page title row). Hoy, Semana and Resumen
   open the menu Tarea · Evento · Rutina; Tareas opens Nueva tarea directly. Rutina keeps today's behaviour (the guided
   setup in add mode, `openAdd('routine')`). Hoy's inline "Añadir para hoy" row and Tareas' capture field stay until
   slices 2 and 4 replace them.
3. **Tablet navigation.** From 768 px the sidebar stays (overlay below 1024, persistent from 1024). The new top tab bar
   in the toolbar shows whenever the sidebar is not shown beside the content, so navigation is never hidden; "panel-left"
   still opens the sidebar.
4. **Hoy shows each thing once (slice 2).** Today the routine that holds the current task (Trabajo) is a row after the
   now line and the task is a row too. The hero names the routine ("Ahora · En Trabajo") and holds the task; neither
   repeats in the list. Overdue tasks placed today (Renovar el pasaporte in the real fixture) keep their rows: the boards
   omit them, the scheduler places them.
5. **Cierre as a conversation (slice 2).** The check-in keeps its fields (bedtime, wake, work end, exercise, stress,
   note, the day's routine answers) and its storage; only the presentation becomes turns. Answers the plan already
   gives are drawn as prefilled bubbles that can be changed.
6. **Ajustes and Asistente as full-height sheets (slice 7).** Their hash routes (`#/settings/...`, `#/assistant`) stay,
   so links, back navigation and existing tests keep working; on a phone the route is presented as a sheet over the tab.
7. **Setup multi-select and "Parte N de 7" (slice 6).** "¿A qué más…?" accepts several picks and asks one short time
   question per pick; the total grows only when a pick adds a step. This is the one behaviour change in setup besides
   "Siguiente" replacing "Enviar".

8. **"+" without categories.** Week's old "+" hid itself until a category existed. The shell's "+" is always offered
   while the planner can be written: a task needs no category (it fits any free time), an event needs none, and Rutina
   opens the guided add, which creates its category.

9. **Semana's "Día · Semana" switch (slice 3).** DIRECTION §7 lists `week.view.showDay` / `week.view.showWeek` as the
   toggle's accessible names. The toggle became a labelled segmented control whose radios are named by their visible
   words ("Día", "Semana") in the group "Vista", so those two keys are removed. A view the person chose is kept when the
   width crosses 768 px; until then a phone opens on Día and a wider screen on Semana.
10. **One word for a conflict (slice 3, REVIEW M2).** "Se cruza" on the block, "Se cruza con {título}" in the event's
    details and "Se cruza con tu plan" on imported events, in every language; a Weeklid event over a routine is marked
    too, as Hoy already did.
11. **Resumen's headline [cambia] (slice 5).** The board says "38 h libres esta semana"; the figure counts from now,
    while the bar's "sin asignar" counts the whole week, so the two would disagree. The headline says "26 h libres desde
    ahora" (en "from now", fr "à partir de maintenant", pt "a partir de agora", de "ab jetzt"). Hoy and Semana keep
    "esta semana" in their smaller badge, which stands alone.

Anything else in a board that the app cannot do as drawn is raised with the coordinator before it changes behaviour.

## Tests that read styles

Some layout rules are checked by reading a component's own styles (`ConversationFrame.modal.spec.ts`), because the App
review's mutant runner has no browser; the e2e still measure the real layout. Rewriting or reformatting those styles
means updating that spec with them. It holds the modal's size and place, `--frame-room` (the frame's height, which the
setup's and the routine conversation's docks take their share of), the docks' own sizing and the zero safe area inside
the centred card.

Covered only by e2e for now, because the review's runner cannot run Playwright: Hoy's WeekGlance and the TaskRow
timeline variant (#67), and the purely visual changes of the setup's work screen (time chips as a three-column grid,
answered turns as trailing bubbles, the lock on the trust line, the 32 px avatar, the day chips' padding; #60). The
routine conversation's tablet e2e protects its outcome but does not tell the old dock rule apart (that dock may
shrink); the rule is held by the style spec (#62).

`frameSettled` (wait for a conversation to finish rising in before measuring it) lives twice, in `today-checkin.spec.ts`
and `setup-guided.spec.ts`: the merge guard does not count `e2e/support/` as test code, so a shared helper there would
make a tests-only change a standard one. They become one helper once it does (#70).

## Open for a later slice

- **Setup's work screen (slice 6a).** R_InicioHorario opens the start times on arrival; the app does so only where the
  answers under them ("Añadir otro horario", "Sin horario fijo", "Siguiente") stay in view, so on a 390 x 844 phone
  and a 1440 x 900 desktop the card starts closed, one tap from its times. "Lo veo después" is not on the work screen:
  leaving work for later needs its own place in the flow (what the summary then shows), not only a button.
- **Back from "Usar con tu IA" (slice 7).** Choosing "Responder con: Usar con tu IA" in the assistant opens its page in
  Settings (`#/settings/ai`), whose back button goes to Settings, not to the assistant; on a phone the sheet's Listo
  goes to the tab. The assistant is one tap away again from the toolbar, but there is no direct way back. A later slice
  should give that page a way back to where it was opened from.
- **Conversation modal width (slice 8).** The centred modal is 35rem wide, so it grows with the text size (about
  1120 px at 200 % on a 1440 px screen, never more than the screen less 32 px); its margins are pixels. Below 700 px
  of height (a small landscape tablet) the conversation stays full screen.

## Tokens and styles added ahead of their screens

Slice 1 adds what later slices draw with: `--radius-bubble`, `--warning-label`, `.t-title-1`, `.t-section` and the
`quiet` button are used by Hoy and the check-in (slice 2); `--tint-soft` and `--fill` by every slice. A token no slice
uses by slice 8 is removed. The contrast specs measure every text token on `--bg`, `--bg-grouped`, `--surface`,
`--surface-2` and `--tint-soft` in light and dark; increased contrast is not yet measured for `--tint-soft` and `--fill`
(follow-up for slice 8).

## Open for a later slice (from the review of Hoy, #54)

- The hero's "Después" line and the list's "Libre" rows can repeat what the list already says (DIRECTION rule 3, each
  thing once).
- During a task the hero does not say what comes next when it is tomorrow.
- A routine hidden behind a task in the hero cannot be marked in its last minutes from Hoy.
- In "Por hacer hoy" at 200 % text the task rows keep an empty time column after the times fold above the titles,
  and "venció el 18 nov" runs 3 px over at 390 px.
