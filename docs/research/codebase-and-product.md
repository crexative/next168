# Next168: codebase map, PR #1 assessment and feature gaps

Epic: https://github.com/crexative/next168/issues/3 · Run date: 2026-10-24 (container clock; task text says 2026-10-23) · Scope: documentation only, no application code changed.
Environment: Node v22.22.0, npm 10.9.4. All commands were run by me in this session; outputs below are trimmed but not altered.

Evidence level: **VERIFIED** = command run or file read in this session. **ASSUMPTION** / **UNKNOWN** are labelled.

---

## 1. Facts: `main` @ 05d781d

### 1.1 Command results (clean `npm ci`, then each command)

| Command | Result |
|---|---|
| `npm run type-check` (`vue-tsc --build`) | exit 0, no output |
| `npm run lint` (run as `npx eslint .`, no autofix) | **7 errors, 0 warnings** (see below) |
| `npx vitest run` | `1 passed (1) files, 5 passed (5) tests`, 0.5 s |
| `npm run build` | passes; `index-*.js 422.33 kB (gzip 146.58 kB)`, `index-*.css 43.07 kB (gzip 7.54 kB)`, 114 modules, 3.4 s |
| `npm audit` | **25 vulnerabilities: 1 low, 6 moderate, 14 high, 4 critical** |
| `npm audit --omit=dev` | **5 high** (`@vue/server-renderer <=3.5.41`, `nanoid <=3.3.17`, `postcss <=8.5.22`, plus their dependents) |

Lint errors (all `@typescript-eslint`): `LanguageSelector.vue:8` unused `buttonRef`; `StatsDashboard.vue:136` `any`; `WelcomeTutorial.vue:14` unused `props`; `i18n/index.ts:12,14` two `any`; `SupabaseRepository.example.ts:25` unused `data`; `ValidationService.ts:31` unused `category`. The CLAUDE.md `npm run lint` script uses `--fix`, which would rewrite files, so I ran eslint without it.

Installed versions (`npm ls`): vue 3.5.22, pinia 3.0.3, vue-i18n 9.14.5, chart.js 4.5.1, vite 7.1.10, vitest 3.2.4, typescript 5.9.3. `engines`: `^20.19.0 || >=22.12.0`. CI uses Node 20 (`deploy.yml`).

Direct audit offenders on main: `vite` (high; 7.0.0–7.3.6 range), `vitest` and `@vitest/ui` (critical via `tinypool`, `shell-quote`), `happy-dom` (high), `vue` (high, `@vue/server-renderer`). Advisory detail: run `npm audit`; every entry links to a `github.com/advisories/GHSA-*` page. I did not open those pages (accessed only through npm's output on 2026-10-24); publication dates are UNKNOWN to me.

### 1.2 Architecture map

```
index.html → src/main.ts (Pinia, vue-router, vue-i18n) → App.vue
App.vue: tab state ('calendar'|'categories'|'stats'), swipe handling, WelcomeTutorial
  components/WeeklyCalendar.vue (1248 lines)  ─┐
  components/CategoryManager.vue (1472)        ├─ useWeekStore (Pinia setup store, 328)
  components/StatsDashboard.vue (682, Chart.js)┘      │
                                                      ├─ ValidationService (226) + utils/timeCalculator, timeBlockUtils
                                                      └─ weekDataRepository (repositoryFactory) → LocalStorageRepository('next168-data')
i18n: 5 locales × 155 lines (en es fr pt de), key 'next168-language'
```

- **State**: one store, `categories: Category[]`, `timeBlocks: TimeBlock[]` (`src/types/index.ts`, 45 lines). `TimeBlock` has `dayOfWeek` 0–6, `startTime`/`endTime` "HH:mm", `durationMinutes`, optional `repeatDays`. No dates, no completion state, no goal type, no tasks, no check-ins.
- **Persistence**: `IWeekDataRepository` (save/load/clear/exists) with `LocalStorageRepository`; `JSON.parse(...) as WeekData` with **no validation and no schema version**. A parse error returns `null`, and the store then calls `initializeSampleData()`, which overwrites storage with sample data on the next save (data-loss path; see 4).
- `StorageService.ts` (`LocalStorageService`) is exported but unused by the store (grep: only its own file). Dead code.
- **Routing**: `vue-router` is installed and wired in `main.ts`, but `App.vue` never renders `<RouterView>`; `HomeView.vue` literally says "This view is not used". Dead: `router/`, `views/`, `vue-router` dependency.
- **Duplicate UI**: `components/BaseModal.vue` (128 lines, used by WeeklyCalendar and CategoryManager) and `components/ui/BaseModal.vue` (204 lines, differs: adds mount/unmount hooks; only re-exported through `ui/index.ts`, which nothing imports). `ConfirmDialog.vue` is used from both `./ui/` and `@/components/ui/` import styles.
- `SupabaseRepository.example.ts` is commented-out reference code that also fails lint.
- **Tests**: one spec, `ValidationService.spec.ts`, 5 tests, all about `canAddTimeToCategory` and repeat days. No coverage tooling configured (`@vitest/coverage-*` not installed), so coverage is UNKNOWN as a number; by inspection it is limited to one method of one service. Nothing covers the store, repository, components, i18n, or time utilities. vitest config excludes `e2e/**` but there is no e2e dir on main.
- **Build/CI**: only `.github/workflows/deploy.yml` (push to `main` or manual → `npm ci` → `npm run build` → Pages). **No lint or test step, no PR CI.** `vite.config.ts` sets `base: '/next168/'` and `server.host: true`. The task says `main` serves next168.app; whether the custom-domain root matches `base: '/next168/'` is UNKNOWN (not verifiable offline).
- **i18n**: vue-i18n v9, composition mode, `any` casts at `i18n/index.ts:12,14`. Locale key parity across the 5 files was not machine-checked (UNKNOWN); all five are 155 lines, which suggests parity. Validation error strings in `ValidationService` and the store are **hard-coded English**, not translated.
- **Mid-session finding on semantics**: `weekStore.updateCategory` computes usage as `sum(durationMinutes)` and ignores `repeatDays`, while `categoryStats` multiplies by unique days. Lowering a limit on a category with repeated blocks can therefore be accepted although usage exceeds the new limit. (Verified by reading the code, not by running it.)

### 1.3 Code-quality hotspots

| Item | Evidence |
|---|---|
| Three oversized SFCs | `CategoryManager` 1472, `WeeklyCalendar` 1248, `StatsDashboard` 682 lines (of 7,591 total in `src/`) mix template, logic, CSS and responsive branching |
| Duplicate/dead code | two `BaseModal`, unused `StorageService`, unused router/views, unused `ui/index.ts` barrel |
| Weak validation of persisted data | `as WeekData` cast on load |
| Id generation | `Date.now()-Math.random().toString(36).substr(2,9)` (deprecated `substr`); fine for local use, not collision-proof for merges/imports |
| Docs sprawl | `ARCHITECTURE.md`, `MASTER_PROMPT.md`, `PRODUCTION_READY.md`, `ROADMAP.md`, `DEPLOYMENT.md`, `CLAUDE.md` in the root; not checked for accuracy against code |

---

## 2. Draft PR #1 (`local/next168-flexible-agenda`, head bbea45a, base 05d781d)

GitHub state (read 2026-10-24 via API): open, **draft**, 1 commit, +2093/−645, 30 files, `mergeable_state: clean`, created 2026-10-05, last updated 2026-10-06. Author `jocode`; PR text says it was authored by a "codex" provider and verified by the author's own process. I could not verify the "MIA" or "ac-verifier" claims in the PR body (UNKNOWN; not reproducible from the repo). No CI runs exist for the branch (the workflow only triggers on `main`), as the PR itself states.

### 2.1 What it adds
- **Dated agenda** (`types/agenda.ts`, `AgendaService`, `agendaStore`, `FlexibleAgenda.vue` 185 lines): `AgendaItem {id,title,date,startTime,endTime,kind: task|meeting|reservation|reminder,status: planned|reserved|done|cancelled,flexible,calendarSelected,notes?,checklist?,budgetCop?}`, stored separately under `next168-agenda-v1` with `schemaVersion: 1` and a `revision` UUID.
- **Strict validators** for items, whole agenda, and a `WeekData` codec (`WeekDataCodec.ts`) used on every routine load/save.
- **Offline assistant contract**: `proposalRequest()` emits JSON for the user to paste to any LLM; `previewMoves()` accepts only `{schemaVersion, baseRevision, moves[{id,date,startTime,endTime}]}`, rejects unknown fields, stale revision, duplicates, non-flexible/done items and any conflict, previews first, applies in one write. No network, no keys.
- **Backups**: full JSON `{schemaVersion:1, agenda, routine}`, validated restore with `*-recovery` copies and rollback; `*-backup` copy before each overwrite; stale-tab detection (`observed` raw value compare); corrupt storage **blocks writes instead of resetting to sample data**.
- **ICS export** (`CalendarExportService`): selected non-task items, UTC from Bogotá, stable UID, RFC 5545 escaping/folding, export fingerprints.
- **Tests**: `AgendaService` 11, `AgendaRepository` 6, `FlexibleAgenda` (mounted DOM) 8, `ValidationService` 5; Playwright e2e 5 scenarios × desktop/mobile.
- **Tooling**: Playwright 1.63.0 pinned, `tsconfig.e2e.json`, `vitest ^3.2.7`, `@vitest/ui ^3.2.7`, lock-file bumps (postcss, nanoid), `docs/FLEXIBLE_AGENDA.md`.

### 2.2 Results I reproduced on the PR head (separate worktree, `npm ci --ignore-scripts`)

| Command | Result |
|---|---|
| `npm run type-check` | pass (app + e2e tsconfig) |
| `npx eslint .` | exit 0, no findings (it also fixed main's `any`/unused issues) |
| `npx vitest run` | **4 files, 30 tests passed**, 1.35 s (one expected `stderr` log from the corrupt-storage test) |
| `npm run build` | pass; `index-*.js 448.56 kB (gzip 155.11 kB)` (+26 kB raw / +8.5 kB gzip vs main) |
| `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test` | **10 passed** (14.4 s). The preinstalled Chromium worked with Playwright 1.63; the repo's script expects a `.browser-cache` download instead |
| `npm audit` | **10 vulnerabilities: 4 moderate, 4 high, 2 critical** (PR doc claims 7 with 0 critical; my run differs, probably because advisories were published after 2026-10-05; I did not diagnose it) |
| `npm audit --omit=dev` | still reports **`@vue/server-renderer <=3.5.41` (high, XSS)**; the PR doc claims production audit = 0. New advisory since the PR was written (inference, unverified) |
| Merge into main | `git merge-tree --write-tree main HEAD` exit 0: **no conflicts** (the PR is one commit directly on 05d781d, and main has not moved) |

### 2.3 Quality assessment
Strengths: the persistence and safety layer is genuinely better than main (validation on load, no silent reset, rollback, stale-tab guard, versioned envelope), tests are meaningful and mount real components, and the assistant contract is a sound, key-free design.

Weaknesses (verified by reading):
1. **Personal hard-coding**: `PLANNER_TIMEZONE = 'America/Bogota'` is a literal type; `workEnd: '17:00'|'17:30'`, work window Mon–Fri 08:30, `budgetCop` (Colombian pesos), "Johan" workflow and a `-05:00` offset in ICS. Not usable by other people without removing these.
2. **Two parallel data models**: weekly routine (`TimeBlock`) and dated agenda (`AgendaItem`) do not share types, stats ignore the agenda, and the agenda cannot cross midnight (`startTime >= endTime` is rejected). It adds a second concept rather than evolving the first.
3. **No migration framework**, only `schemaVersion: 1` checks that reject anything else; `decodeWeekData` rejects `weeklyHourLimit <= 0` and unknown shapes strictly, so a future field breaks restore of older/newer backups.
4. i18n only for en/es; domain errors in English; agenda strings live in `i18n/agenda.ts` outside the locale files.
5. `FlexibleAgenda.vue` is dense (long single-line conditionals in `AgendaService`), the diff is 224 KB, and the PR is not reviewable by CI (no PR workflow).
6. The legacy overnight overlap bug is explicitly untouched (see 3, feature 5).
7. Crypto: `crypto.randomUUID()` requires a secure context (fine on https/localhost).

### 2.4 Recommendation on PR #1: **cherry-pick, do not build on it as a whole; start features from `main`**
Keep (adapt, then land on a new branch from `main`):
- `AgendaRepository` envelope ideas: validate-on-load, never auto-reset on corruption, `-backup`/`-recovery` keys, stale-tab guard, restore with rollback.
- `WeekDataCodec` (generalise into a versioned `decodeWeekData` with migrations).
- Backup/restore JSON format and its tests; the e2e scaffolding (Playwright config, headless isolation) and the type-check/lint cleanups.
- The proposal contract (`baseRevision`, exact-key validation, preview-then-apply). It fits the "connect your own LLM" goal and needs no keys.
- ICS exporter (parameterise the timezone).
Drop or rewrite: Bogotá/COP/work-window constants, `FlexibleAgenda.vue` UI (will be replaced by the redesign), the separate agenda store as a second data model, `docs/FLEXIBLE_AGENDA.md` personal-pilot sections.
Why not build directly on it: the personal constants are woven through types and tests, and the redesign plus new entities (tasks, check-ins, goal types) would rewrite the same files; merging first adds +26 kB and two data models to maintain. Why not ignore it: its storage-safety work is the part main most lacks.

---

## 3. Gap analysis vs the nine prototype features

Legend: **No** = not present on main nor PR #1.

| # | Prototype feature | main | PR #1 | Work needed / data-model change |
|---|---|---|---|---|
| 1 | "Now" view: current block, time left + progress, next block incl. tomorrow's first | No. Calendar only highlights today's column (uses `dayjs().day()`); no now-line, no clock tick | No (agenda is date-list; no clock logic) | New computed `currentBlock/nextBlock` over weekly blocks, minute ticker, midnight wrap. No schema change |
| 2 | Today's timeline merging plan blocks + auto-placed tasks + external calendar events, current item and conflicts highlighted | No | Partial: dated items list and conflict rejection; no merge with routine, no external events (ICS export only, no import) | Needs tasks entity (3) and an `ExternalEvent` input (ICS import or manual) UNKNOWN whether wanted for v1 |
| 3 | Tasks (title, 15 min–3 h, category, due, priority) auto-fitted into free time of that category's blocks over 7 days, overflow warning, done/undone, recent-done | No | Partial/different: `AgendaItem kind:'task'` with manual date/time, status done/cancelled, **no category, no priority, no due date, no auto-fit** | New `Task {id,title,durationMin,categoryId,dueDate?,priority,doneAt?,placement?}` and a pure scheduling function (free time = category blocks − busy − past). Highest-effort feature; pure function is easily unit-tested |
| 4 | Goal type `max`/`min`, chips "over cap by X h"/"missing X h", 168 h stacked bar with unassigned | Partial: only a cap (`weeklyHourLimit`); `StatsDashboard` shows progress bars, week utilisation and unscheduled hours; adding blocks beyond cap is **blocked**, so "over cap" cannot exist; no minimum | No change | Add `goalType: 'max'|'min'` (default `'max'`); relax the hard block for `max` into a warning (product decision, UNKNOWN); stacked 168 h bar is a small Chart.js/CSS addition |
| 5 | Blocks crossing midnight rendered on both days | Partial/buggy: `calculateDurationMinutes` handles wrap (22:00–06:00 = 480 min), but `ValidationService.checkTimeOverlap` uses `s1<e2 && e1>s2` with no wrap, so overnight overlaps are mis-detected; the calendar renders the block only on `dayOfWeek` (no `midnight`/`cross` handling found by grep) | Dated agenda rejects it; routine unchanged | Normalise overnight blocks into two day-segments at render/overlap time (keep one stored block); fix overlap with minute-of-week intervals. No schema change needed |
| 6 | Nightly check-in (bedtime, wake, work end, gym y/n/not planned, stress 1–5, note) | No | No | New `CheckIn {date, bedtime, wake, workEnd, gym: 'yes'|'no'|'na', stress:1-5, note}` keyed by date; new `checkIns` collection |
| 7 | 7-day measures (avg sleep, gym vs goal, late-work nights, avg stress, green/amber/red dots) | No | No | Derived computed from check-ins; thresholds are product decisions (UNKNOWN) |
| 8 | Week grid with day tabs on mobile, now-line, tap block to edit in bottom sheet | Mostly: desktop 7-col, tablet 3-col, mobile single day with prev/next, `BaseBottomSheet` editing (title, category, start, end, days). Missing: day tabs (it uses prev/next), now-line | Not changed | Add now-line and day-tab strip; edit sheet exists |
| 9 | Light/dark tokens, reduced motion | Partial: `assets/base.css` defines brand/semantic CSS variables and has one `@media (prefers-color-scheme: dark)` block (line 65; I did not check how complete it is). `grep` finds **no** `prefers-reduced-motion` anywhere in `src/` | No | Complete the dark token set, add a reduced-motion media block; part of the redesign |

### 3.1 Data-model changes and migration path (proposal)
Target `localStorage['next168-data']` envelope:
```
{ schemaVersion: 2, categories: [{...old, goalType:'max'}], timeBlocks: [...old],
  tasks: [], checkIns: [], settings: { timezone, locale, weekStartsOn } }
```
Migration: on load, if the JSON lacks `schemaVersion` treat it as v1 (today's `WeekData`), run a pure `migrate(v1→v2)` that adds `goalType:'max'`, empty `tasks`/`checkIns`, `settings` from `Intl.DateTimeFormat().resolvedOptions().timeZone`. Before the first write after a migration, copy the raw v1 string to `next168-data-v1-backup`. Existing blocks with `endTime < startTime` need no rewrite (wrap at render). Make each step idempotent and unit-test it with real v1 fixtures, including the `repeatDays` duplicates case that existing tests cover. If the owner's current data differs from the sample shape, that is UNKNOWN (I have no access to anyone's browser storage).

---

## 4. Multi-user, local-first: what must change

Verified current behaviour: first run calls `initializeSampleData()` with five **generic, translated** categories (sleep 56 h, work 40, exercise 7, learning 10, personal projects 15), so main is already free of the owner's data. Gaps:
1. **Onboarding**: `WelcomeTutorial` exists (flag `next168-tutorial-completed`), but there is no goal-setting or "start empty vs from template" choice. Sample categories are pre-seeded even if the user wants none; 56+40+7+10+15 = 128 h of caps is an arbitrary default.
2. **Empty states**: not audited component by component (UNKNOWN); with no blocks, stats show zeros, the calendar is blank.
3. **Export/import**: **none on main**. PR #1 has a validated one to reuse. This is the main safety net given browser data clearing, private mode and device loss; the PR itself notes local storage is not cloud sync.
4. **Schema versioning**: absent on main; add before introducing any new entity.
5. **Data-loss risks on main (verified in code)**:
   - corrupt or hand-edited JSON → `load()` returns `null` → sample data replaces it and is saved; no recovery copy;
   - `JSON.parse() as WeekData`: wrong-shaped data can crash components instead of being rejected;
   - two tabs overwrite each other (last write wins, no `storage` event handling);
   - `saveToStorage` returns a failure flag that is only `console.error`'d; quota/private-mode failures are silent to the user;
   - no persistent-storage request (`navigator.storage.persist()`); browsers may evict in low-storage situations (ASSUMPTION about eviction behaviour; not verified here).
6. **Privacy**: nothing leaves the device on main; PR #1's assistant is a copy-paste contract, so no keys or network are needed. A future on-device model or user-chosen LLM connection is outside this document's scope and was not researched here.
7. **Localisation/time**: store and validation messages are English-only; timezone is implicit (browser). Avoid PR #1's fixed timezone.

---

## 5. Dependency / security status

- Node: dev machine v22.22.0; `engines` `^20.19.0 || >=22.12.0`; CI pinned to Node 20 (satisfies `^20.19.0` only if the runner resolves a ≥20.19 patch; not verified).
- Vite 7.1.10 installed, flagged high in the audit range `7.0.0 – 7.3.6`; `npm audit fix` is offered for it. Vitest 3.2.4 + `@vitest/ui` flagged critical (via `tinypool`/`shell-quote`). These are dev-time tools; the **production** tree has 5 high (`@vue/server-renderer`, `nanoid`, `postcss`). Whether the deployed bundle actually includes the vulnerable code paths is not established; the PR's note that the Vite module graph contains no PostCSS/Nano ID is an unverified claim by its author.
- PR #1 reduces the full audit from 25 to 10 (my runs) but adds a ~40 MB Playwright dev dependency tree and still reports one production high.
- No secrets or API keys found in the files I read (`grep`/full scan not performed; ASSUMPTION).

## 6. What changed in the last 3 months (2026-07-24 → 2026-10-24)

- **`main`: nothing.** The last of its 9 commits is 2025-10-19 (`git log main`), i.e. no commits for about 12 months.
- **PR #1** was opened 2026-10-05 and is still an open draft (+2093/−645), updated last 2026-10-06; no reviews or CI results are attached (comments: 1, not read).
- **Dependencies**: since the lockfile was last generated, the registry has published new advisories against the installed `vite`, `vitest`, `vue` (server-renderer), `postcss`, `nanoid`, `happy-dom` versions (this is why `npm audit` now reports 25 on main). Exact advisory dates: UNKNOWN (not opened).
- Epic #3 (research) is the only other activity. I did not read its comments.

## 7. Recommendations (ordered)

1. Branch from `main` (not PR #1). First land a "foundation" change set: lockfile security bump, fix the 7 lint errors, delete dead code (router/views, unused `StorageService`, duplicate `BaseModal`), add CI workflow that runs type-check, lint, `vitest` and build on PRs.
2. Port PR #1's storage layer: versioned envelope, validate-on-load, no silent reset, `-backup`/`-recovery`, stale-tab guard, JSON export/import with preview.
3. Introduce `schemaVersion: 2` with `goalType`, `tasks`, `checkIns`, `settings` and a tested migration from v1.
4. Fix midnight handling (overlap + render split) before building the Now view and timeline, since both depend on it.
5. Implement features in this order for value/risk: goals max/min + 168 h bar (small) → Now view → task auto-fit as a pure, heavily tested function → timeline merge → check-in and measures → day tabs/now-line, dark tokens, reduced motion (with the redesign).
6. Keep the assistant as PR #1's copy-paste proposal contract first; any on-device model or LLM connector needs its own research.

## 8. Risks and UNKNOWNs

- UNKNOWN: real usage, number of existing users and what shape their stored data has (no access to browsers; matters for migration).
- UNKNOWN: whether next168.app root vs `base: '/next168/'` works (deploy config not testable here).
- UNKNOWN: numerical test coverage (no coverage tool installed).
- UNKNOWN: locale key parity, completeness of the existing dark palette, empty-state quality per component.
- UNKNOWN: the exact disagreement between my audit counts on PR #1 (10, one production high) and the PR text (7, production 0); likely newer advisories, not diagnosed.
- UNKNOWN: PR #1's "MIA"/"ac-verifier" verification claims (not reproducible from the repo).
- Risk: `main` auto-deploys to production; every change here must go through branches/PRs, never straight to `main`.
- Risk: making `max` goals soft changes the current "blocked at the cap" behaviour users may rely on.
- Not done in this document: no external primary sources were consulted (no web research was needed for the code questions); anything about Gemma/browser LLMs, MCP and competitor planners is out of scope here and must be researched separately with dated sources.

## Appendix: reproduce

```
git fetch origin local/next168-flexible-agenda
npm ci && npm run type-check && npx eslint . && npx vitest run && npm run build && npm audit
git worktree add ../pr1 origin/local/next168-flexible-agenda   # then repeat in ../pr1
PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers npx playwright test   # in ../pr1, after build
git merge-tree --write-tree main origin/local/next168-flexible-agenda
```
