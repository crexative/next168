# Next168 deliverable 1 — architecture

Epic: [#3](https://github.com/crexative/next168/issues/3) · GOAL: [deliverable 1](https://github.com/crexative/next168/issues/3#issuecomment-6379989364) · Architect: MIA coordinator (Claude Opus 5.5), 2026-10-24 · Status: **revision 3 — red-team and delta findings absorbed (§7)**.

Inputs (all on this branch): `docs/research/codebase-and-product.md`, `docs/research/llm-connectivity.md`, `docs/research/on-device-ai.md`, `docs/research/competitors-commercial.md`, `docs/research/competitors-open-source.md`, `docs/design/visual-design.md`. Coordinator verifications on 2026-10-24: Hugging Face API reports `mlc-ai/gemma-4-E2B-it-q4f16_1-MLC` = 2,831 MB in 94 files, licence `apache-2.0`; `Llama-3.2-1B-Instruct-q4f16_1-MLC` = 705 MB; `Qwen3-1.7B-q4f16_1-MLC` = 984 MB. Chrome's Prompt API page (updated 2026-08-26) lists desktop only, >4 GB VRAM, 16 GB RAM, 22 GB free disk, and `responseConstraint` JSON Schema support.

## 1. Constraints

- Local only for now: no backend, account, paid service, tunnel or deployment. `main` auto-deploys to next168.app, so all work lands on `feature/#3-local-first-next168` through PRs; nothing merges to `main`.
- Public MIT repository: no personal data, no GPL/AGPL code copied.
- Must run in any modern browser on any screen size and install as a PWA. Everything that needs a process (MCP, ICS URL proxy) is an optional companion; the browser-only app is complete on its own.
- Existing users' `localStorage['next168-data']` (v1 `WeekData`) must migrate without loss.

## 2. Decisions

| # | Decision | Rejected alternatives and why |
|---|---|---|
| D1 | **Start from `main`; port selected ideas from draft PR #1** (validated load, never auto-reset on corruption, backup key, stale-tab guard, proposal contract with `baseRevision`, ICS escaping/folding, Playwright scaffold). PR #1 is not merged. | Building on PR #1: Bogotá/COP constants are woven through it and it adds a second data model. |
| D2 | **One planner document, schema v2**, versioned envelope in `localStorage['next168-data']`, validated with `zod` (MIT) on every load and import; ordered pure migrations (`v1 → v2`); raw pre-migration copy in `next168-data-v1-backup`; corrupt data blocks writes and shows recovery, never resets to samples. | IndexedDB: not needed at this data size (YAGNI); repository port keeps it swappable. |
| D3 | **Pure core in `src/core/`** (no Vue, no DOM): schema, migrations, minute-of-week time math, overlap, scheduler, stats/measures, proposals, ICS parse/export, calendar links, assistant prompt/schema. The companion bundles the same code. | Duplicating logic in the companion: drift between UI and MCP. |
| D4 | **Repository port** `PlannerRepository { load(): LoadResult; save(doc, expectedRevision): SaveResult; subscribe(onExternalChange) }`. Adapters: `LocalStorageRepository` (browser mode, `storage` event for cross-tab) and `CompanionRepository` (HTTP to the companion with conditional writes). Saves are awaited; failures surface to the user. | Fire-and-forget saves (today): silent data loss. |
| D5 | **Optional local companion** (`companion/`, Node ≥ 20, MIT deps): one process owns `~/.next168/planner.json` (atomic write + `.bak`), serves the built app at `http://127.0.0.1:1680`, exposes `/api/*` for the UI, `/mcp` (Streamable HTTP) and a stdio adapter (`next168-companion mcp`) that proxies to the running companion (single writer). Loopback only, exact `Host` check, `Origin` allowlist, bearer tokens. | Browser-tab bridge: needs the tab open, two writers. WebMCP: experimental, approval clickable by agents. Tunnel/remote: violates local-only. |
| D6 | **Proposals are the only write path for any model.** MCP exposes read tools plus `propose_changes`/`get_proposal`; `apply` is a UI-only endpoint authenticated by a separate UI token injected into the page the companion serves, never given to MCP clients. Browser-only mode gets the same review UI through "export snapshot + prompt" and "import proposal JSON". On-device assistant also emits proposals. All ops in a proposal apply atomically or not at all; stale `baseRevision` → reject and ask for a fresh proposal. | `apply_changes` as an MCP tool: model could approve itself. |
| D7 | **Calendars without OAuth**: parse `.ics` with `ical.js` (MPL-2.0, used unmodified as a dependency), expand recurrences for the visible week, show as read-only busy overlay with conflict marks. Subscription URLs are fetched directly; on CORS failure the browser-only app explains and offers file import, and companion mode fetches through `/api/ics?url=` (http/https only, size and time limits, no redirects to private IPs). Events/meetings created in Next168 export as `.ics` (`METHOD:PUBLISH`, attendees as `ATTENDEE`), Google template link and Outlook compose link. | Google/Microsoft OAuth: needs owner-registered app and Google verification → deliverable 2. |
| D8 | **PWA via `vite-plugin-pwa`** (generateSW, prompt-to-update), manifest with 192/512/maskable icons generated from one SVG, `base: './'` so the same build works at `/`, at `/next168/` and inside the companion. Model weights are never precached. Request `navigator.storage.persist()` after onboarding. | Hand-written SW: more code to test. |
| D9 | **On-device assistant behind `AssistantProvider`**: `RulesProvider` (always on; deterministic answers from core stats), `WebLlmProvider` (`@mlc-ai/web-llm`, dynamic import, Web Worker, JSON-schema-constrained proposals; models: Gemma 4 E2B 2.83 GB default on capable devices, Llama 3.2 1B 0.7 GB light), `PromptApiProvider` (Chrome `LanguageModel` when `availability()` allows). Opt-in, size shown before download, delete-model button. The model never computes totals. | Making AI required: blocks devices without WebGPU. |
| D10 | **UI rebuild** per `docs/design/visual-design.md`: `src/app/` shell (bottom tab bar on phone, sidebar ≥ 1024 px), `src/ui/` primitives (Sheet with `motion` springs and drag, Button, ListGroup, SegmentedControl, UndoToast, Icon via `lucide-vue-next`), `src/features/<feature>/` views. Remove Chart.js, vue-router, dead code, duplicate modals. | Restyling the existing 1,400-line components: hides the 168-hour model and keeps the debt. |
| D11 | **i18n per feature namespace** (`src/i18n/<locale>/<feature>.json`), all 5 locales required; a unit test fails on missing keys. Domain errors are codes translated in the UI. | Single 155-line file per locale: merge conflicts across slices. |
| D12 | **Tests**: Vitest for core (target ≥ 90 % lines in `src/core`), component tests where logic lives in components, Playwright e2e (Chromium desktop 1440×900, tablet 768×1024, phone 375×812 with touch; WebKit phone smoke), `@axe-core/playwright`, Lighthouse CLI for the accessibility score, offline test after SW activation, reduced-motion/transparency emulation, `--disable-features=WebGPU` run. A `ci.yml` runs type-check, lint, unit, build and e2e on PRs to the integration branch (public repo: free hosted minutes). | — |

## 3. Data model (schema v2)

```ts
type Minute = number                // minutes since 00:00, 0..1439
type DayIndex = 0|1|2|3|4|5|6       // 0 = Sunday (kept from v1)
interface PlannerDocument {
  schemaVersion: 2
  revision: number                  // +1 on every committed save
  updatedAt: string                 // ISO
  settings: { locale: string; weekStartsOn: 0|1; timeZone: string; onboardingDone: boolean; theme: 'system'|'light'|'dark' }
  categories: Category[]
  blocks: TimeBlock[]               // weekly template
  tasks: Task[]
  checkIns: CheckIn[]               // one per local date
  actuals: BlockActual[]            // plan vs actual per dated occurrence
  events: PlannerEvent[]            // created in Next168, exportable to calendars
  calendarSources: CalendarSource[] // imported .ics files or URLs
  externalEvents: ExternalEvent[]   // cached parsed events from sources (read-only)
  proposals: ChangeProposal[]       // pending/applied/rejected history (bounded)
}
interface Category { id; name; colorKey: ColorKey; icon?: string; goal: { type: 'max'|'min'|'none'; hoursPerWeek: number } }
interface TimeBlock { id; categoryId; title; notes?; days: DayIndex[]; start: Minute; end: Minute }   // end <= start => crosses midnight
interface Task { id; title; categoryId; durationMin: 15..180; dueDate?: string; priority: 1|2|3; doneAt?: string; createdAt: string }
interface CheckIn { date: string; bedtime?: Minute; wake?: Minute; workEnd?: Minute; exercise?: 'yes'|'no'|'not-planned'; stress?: 1|2|3|4|5; note?: string }
interface BlockActual { date: string; blockId: string; status: 'done'|'partial'|'skipped'; minutes?: number }
interface PlannerEvent { id; title; start: string; end: string; allDay: boolean; location?; notes?; attendees: string[] }
interface CalendarSource { id; name; kind: 'file'|'url'; url?; colorKey; lastSyncedAt?; lastError? }
interface ExternalEvent { sourceId; uid; title; start: string; end: string; allDay: boolean; busy: boolean }
interface ChangeProposal { id; source: 'mcp'|'assistant'|'import'; clientName?; baseRevision: number; summary: string; ops: ProposalOp[]; status: 'pending'|'applied'|'rejected'|'stale'; createdAt; decidedAt? }
type ProposalOp =
  | { op: 'add_block'; block: Omit<TimeBlock,'id'> } | { op: 'update_block'; id; patch: Partial<Omit<TimeBlock,'id'>> } | { op: 'delete_block'; id }
  | { op: 'add_task'; task: Omit<Task,'id'|'createdAt'|'doneAt'> } | { op: 'update_task'; id; patch } | { op: 'complete_task'; id }
  | { op: 'add_event'; event: Omit<PlannerEvent,'id'> } | { op: 'update_category_goal'; id; goal }
```

Migration v1 → v2: `dayOfWeek ∪ repeatDays` → `days` (dedupe); `"HH:mm"` → minutes; `durationMinutes` dropped (derived); `weeklyHourLimit` → `goal {type:'max', hoursPerWeek}`; hex `color` → nearest `ColorKey`; empty new collections; `settings` from `Intl` and `next168-language`; `onboardingDone = true` if v1 had data or `next168-tutorial-completed`. Fixtures from real v1 shapes, including duplicate repeat days and an overnight block.

Semantics fixed in core: occurrences are intervals on a 10,080-minute week ring; overlap and stats use them, so overnight blocks and repeats count once per day. `max` goals warn, they no longer block (product change, recorded here). Measures: average sleep from check-ins (bedtime→wake), exercise count, late-work nights (workEnd ≥ 21:00 or < 05:00), average stress, plan-vs-actual minutes per category from `actuals`.

Task fitting (pure, deterministic): for the next 7 days, free windows = occurrences of the task's category blocks − busy external events − Next168 events − past time − already placed tasks; tasks sorted by due date, priority, creation; chunks ≥ 10 min; result per task = placements + `overflow` (minutes missing) + `late` (lands after due date).

## 4. Companion API (D5, D6)

- `GET /api/document` → `{document}`; `PUT /api/document` with `If-Match: <revision>` → 200 `{revision}` or 409. UI token required (`Authorization: Bearer <ui>`; the token is injected as `window.__NEXT168__ = { mode: 'companion', uiToken }` into `index.html` only when served by the companion).
- `GET /api/proposals?status=pending`, `POST /api/proposals/:id/apply` `{baseRevision}` (UI token only), `POST /api/proposals/:id/reject`.
- `GET /api/ics?url=` (UI token) → raw ICS text; https/http only, 5 MB, 10 s, blocks private/loopback targets.
- `/mcp` Streamable HTTP and `mcp` stdio adapter, MCP token from `~/.next168/mcp-token` (0600). Tools: `get_week`, `list_categories`, `list_blocks`, `list_tasks`, `list_events` (plan + external for a date range), `get_stats`, `propose_changes`, `get_proposal`. Tool inputs/outputs come from the same zod schemas (`z.toJSONSchema`). No apply tool.
- The UI polls `/api/proposals` every 5 s while visible and shows a badge plus a review sheet with the exact diff and validation result.

## 5. Slices, owners and order

Contracts first: `src/core/model.ts` (types + zod schemas above) is written by the architect and committed before S0 starts.

| Wave | Slice | Scope (owned paths) | Depends on |
|---|---|---|---|
| 0 | **S0-core** | `src/core/**` logic + unit tests: schema, migrations, time ring, overlap, stats/measures, scheduler, proposals apply/validate/diff, ICS export, calendar links | contracts |
| 0 | **S0-shell** | Remove dead code; tooling (deps bump, lint clean, `ci.yml`, Playwright config + fixtures, Lighthouse/axe scripts); PWA; design tokens and `src/ui/**` primitives; `src/app/**` shell with Today/Week/Tasks/Insights/Settings routes as placeholders; Pinia `plannerStore` over the repository port; `LocalStorageRepository` with v1 migration and recovery; i18n restructure | contracts |
| 1 | **S1-today-week** | `src/features/today/**`, `src/features/week/**`: Now card, timeline, actuals one-tap, time-axis week grid, midnight split, now-line, day pager with spring swipe, block editor sheet with inline validation, undo | S0 |
| 1 | **S2-plan-measure** | `src/features/tasks/**`, `insights/**`, `checkin/**`, `onboarding/**`, `settings/data/**`: tasks with auto-fit + overflow, 168-segment bar, goals, measures, check-in, onboarding templates, export/import/delete-all | S0 |
| 1 | **S3-calendars** | `src/features/calendars/**`, `src/core/ics-import*`: ICS file/URL import, recurrence expansion, overlay + conflicts, events/meetings create + export links | S0 |
| 1 | **S4-connect** | `companion/**`, `src/repositories/CompanionRepository.ts`, `src/features/proposals/**`, `src/features/settings/connect/**`, `docs/connect-your-llm.md`: companion, MCP, proposal review UI, snapshot export + proposal import for browser mode | S0 |
| 1 | **S5-assistant** | `src/features/assistant/**`, `src/workers/**`: providers, capability probe, opt-in download, chat sheet, proposals | S0 |
| 2 | **V-verify** | Independent verifier: full e2e matrix, Lighthouse, offline, Android emulator install via `adb reverse`, real MCP client session, WebGPU on/off, evidence to #3 | all |

Each slice: branch `feature/#3-<slice>` from the integration branch, PR into the integration branch, CI green, independent review by a provider different from the author, then merge into the integration branch (never `main`).

## 6. Executable acceptance (maps to GOAL criteria)

| GOAL | Check (automated unless noted) |
|---|---|
| 1 | Playwright `e2e/responsive.spec.ts`: widths 320, 375, 768, 1024, 1440, 1920 → `document.scrollingElement.scrollWidth <= innerWidth`; every interactive element ≥ 44×44 px on touch projects; screenshots of 5 views × 3 sizes × 2 themes saved to `e2e/artifacts/` |
| 2 | `e2e/pwa.spec.ts`: manifest fields and icons fetchable; SW active; `context.setOffline(true)` + reload shows the user's seeded blocks. Manual-but-recorded: Android emulator Chrome via `adb reverse` shows "Install app" and launches standalone |
| 3 | `e2e/planner.spec.ts` flows: onboarding with template → Today shows Now card; overnight block visible on both days; add task → placed in category free time; overflow warning; max/min chips; check-in saved → measures update |
| 4 | Unit: migration fixtures v1 → v2 round-trip; corrupt JSON → no overwrite + recovery UI; e2e: export → delete all → import → identical document |
| 5 | axe: 0 serious/critical; Lighthouse accessibility ≥ 95 on Today and Week; reduced motion → no running transform animations; reduced transparency → no `backdrop-filter`; screenshots reviewed against the visual spec |
| 6 | Unit: ICS parse (RRULE, EXDATE, all-day, TZID) and export (escape, fold, ATTENDEE); e2e: import fixture `.ics` → events on Week with conflict mark; create meeting → `.ics` download parses back; Google/Outlook links carry title/time/attendees |
| 7 | Companion integration test: MCP client (SDK) lists tools, reads week, proposes; apply is rejected with the MCP token; UI approves → document revision +1. Real session: `claude -p` with `--mcp-config` calls `get_week` and `propose_changes`, proposal appears in the UI and is approved |
| 8 | e2e with WebGPU disabled → assistant says unavailable, planner works; unit: proposal schema validation of model output; real WebGPU run on the Mac with the 1B model: question answered, proposal reviewed |
| 9 | CI green on the integration branch HEAD: type-check, lint, unit, build, e2e |

## 7. Revision 2 — red-team resolution (binding; supersedes §1–§6 where they conflict)

Red team: Codex gpt-6.1-sol, 2026-10-24 04:51–04:57 UTC, review of `f4597a9` (3 BLOCKER, 11 MAJOR, 1 MINOR; S0-core, S0-shell, S2, S3, S4 rejected). Each finding and its resolution:

| # | Finding | Resolution |
|---|---|---|
| 1 BLOCKER | Page-injected UI token lets any HTTP client approve | **No token in HTML.** Companion pairing: on start it prints a one-time code and opens `http://127.0.0.1:<port>/#pair=<code>`; the page exchanges it (`POST /api/pair`) for an `HttpOnly; SameSite=Strict; Path=/api` session cookie. UI API calls (document PUT, approve, reject, ics) require that cookie; MCP requests use the MCP bearer token and can only read and create proposals. Approve binds to `{proposalId, contentHash, baseRevision}`. **Threat boundary (documented in `docs/connect-your-llm.md`):** MCP clients are untrusted for writes; any agent that controls the user's own browser or OS session is outside the boundary, like for every local app. |
| 2 BLOCKER | localStorage cannot compare-and-save | Every browser commit and migration runs inside `navigator.locks.request(STORAGE_KEYS.lockName, {mode:'exclusive'})`, re-reads the stored revision inside the lock, writes backup then document. Without Web Locks the app opens read-only with an explanation. Two-tab race e2e required. |
| 3 BLOCKER | Old v1 tab overwrites migrated data | v2 lives under `next168-v2`; `next168-data` is never written by v2 code and is only migration input. If the legacy key changes after migration, show "an older version of Next168 is open in another tab" and offer re-import. |
| 4 | Lossy migration | `description → notes`; hex color preserved in `customColor`; field-level preservation tests. |
| 5 | Proposals stale themselves; replay | Proposals live outside the document (`next168-v2-proposals` / `proposals.json`) with `workspaceId`, immutable ops and `contentHash`; pending→applied is a single serialized transition storing `appliedRevision`; re-approve returns the recorded result. Tests: duplicate delivery, concurrent approval, response lost after commit. |
| 6 | Write protocol undefined | Order: build candidate on a clone → validate → serialized commit (backup previous bytes, then write new; companion: temp file + fsync + rename + dir fsync, in-process mutex) → only then publish to the store. Any failure: previous document intact, store unchanged, error shown. On load, invalid primary → offer `.bak`/backup restore, never auto-replace. Fault-injection tests (quota, permission, crash between steps, concurrent requests). |
| 7 | Mode/origin switch looks like data loss | Settings → "Where your data lives" shows mode, origin and workspace name; transfer = export → import with read-back hash verification; empty companion offers import; iOS guidance: export before "Add to Home Screen", import inside the installed app. |
| 8 | Template edits rewrite history | `BlockActual` snapshots `categoryId`, `plannedStart`, `plannedEnd`; semantics done/partial/skipped defined in `model.ts`; unique per (date, blockId, plannedStart). |
| 9 | Week ring vs dated time | Two layers: nominal template minutes (stats on the 168-hour template) and zoned dated intervals for Today, check-ins, scheduler and calendars. Local date + nominal minute → instant with `compatible` disambiguation (gap → shift forward; fold → earlier offset), half-open intervals, equal start/end rejected, week start from settings. Tests: Europe/Berlin 2026-03-29 and 2026-10-25, America/Bogota, Saturday→Sunday wrap. |
| 10 | Calendar data cannot rebuild future weeks | Source text stored in IndexedDB (`next168-calendars`, keyed by source id; refetchable for URL sources, retained for file sources); expansion on demand for any range; occurrence identity `sourceId+uid+recurrenceId`; DATE values = all-day local dates with exclusive end; floating = user time zone; TZID resolved from embedded VTIMEZONE first, then IANA via `Intl`, then a Windows→IANA table. `externalEvents` removed from the document. |
| 11 | SSRF / expansion DoS | Proxy resolves and validates every address (IPv4/IPv6/mapped, private, loopback, link-local, multicast), connects to the pinned address, manual redirects (max 3, each revalidated), strips credentials, limits decompressed bytes. Expansion: reject `FREQ=SECONDLY|MINUTELY`, cap 5,000 occurrences and 50,000 iterations per source per range. |
| 12 | PWA caches token/upgrade races | Token-free HTML (finding 1). SW precaches static assets only, `/api/*` network-only. An app that finds a newer `schemaVersion` opens read-only with "update available"; updates reload all tabs via `BroadcastChannel('next168')` after the in-flight commit settles. |
| 13 | Weak acceptance evidence | ICS export verified with an independent parser (Python `icalendar` in the verifier) and re-import; a tested provider/CORS matrix (real public Google holiday feed and others) recorded in `docs/calendars.md`; installability checked with Chrome DevTools Protocol `Page.getInstallabilityErrors` (empty) plus SW control and offline launch, at both `/` and `/next168/` bases. |
| 14 | Contracts too thin for parallel work | Frozen in `model.ts`: storage keys, `Clock`, scheduler `TaskPlacement`, `ProposalRepository`, `ExternalOccurrence`. S0-shell provides `registerSettingsSection()` and a view registry so slices plug in without editing shared files. `src/core/icsImport*` belongs to S3, not S0-core. Category CRUD UI belongs to S2. The coordinator owns integration merges and shared-file conflicts. |
| 15 MINOR | AI breadth | D1 ships `RulesProvider` + `WebLlmProvider` only; default model `Llama-3.2-1B-Instruct-q4f16_1-MLC` (705 MB, verified), Gemma 4 E2B offered only with `shader-f16` and enough memory; `response_format.schema` passed as a JSON string; OOM, cancellation, device-lost and offline-reload tests. Chrome Prompt API moves to deliverable 2. |

### Revision 3 — delta review (Codex, 2026-10-24) resolutions

Delta verdict on revision 2: blockers 1–3 and findings 4 and 11 resolved; four new MAJOR contract defects and several partials. Resolved in `model.ts` and here:

- **Proposal workspace binding:** `proposalInputSchema.workspaceId` is required and must equal the document's; mismatch → rejected before a proposal is stored.
- **Proposal/document crash atomicity:** the document carries `appliedProposalIds`, committed in the same write as the content change. Approve first checks it: if the id is present, only the proposal status is repaired. Crash between the two writes can never double-apply.
- **Companion durability:** the commit point is the `rename`. A later directory-fsync failure is returned as `ok` with a `durability-unknown` warning and the file is re-read on next load; failures before the rename leave the previous file intact.
- **Calendar portability:** `CalendarSourceStore` port with IndexedDB (browser) and companion file (`~/.next168/calendars/<id>.ics`, `/api/calendars/:id`) adapters; `ExportBundle` carries the document plus raw source texts, verified by hash after import.
- **Actuals:** snapshot zoned `plannedStartAt`/`plannedEndAt` and elapsed `plannedMinutes` (overnight and DST correct); uniqueness `(blockId, plannedStartAt)` enforced by core semantic validation.
- **Placements:** `PlacementChunk` uses ISO instants; local values are derived for display. `scheduleTasks(input: ScheduleInput)` signature frozen.
- **Shell registration:** frozen in `src/app/contracts.ts` (`registerView`, `registerSettingsSection`).
- **Updates and unsaved forms:** a new version never force-reloads; every tab shows "Update available — reload when ready"; the tab that clicks it reloads only after its in-flight commit settles, and open sheets with unsaved input block the reload with a prompt.
- **Calendar outcomes:** subscription refresh verified against a local server whose feed changes between fetches; importing into a real Google/Outlook account is an owner check (recorded as such), because no agent account exists and writing to the owner's calendar is out of scope.
- **AI scope:** Gemma 4 E2B is deferred to deliverable 2; D1 ships Rules + WebLLM with `Llama-3.2-1B-Instruct-q4f16_1-MLC` only, which is the model the acceptance run verifies.

### Revision 4 — durable browser storage (2026-10-24)

Evidence: after `adb shell am force-stop com.android.chrome` the installed app reopened empty 3/3 (verification round 3, defect R2). localStorage writes were lost; an IndexedDB value written with `durability: 'strict'` survived. This revision supersedes D2's "IndexedDB: not needed (YAGNI)" and amends D4.

- **Store.** The browser planner lives in IndexedDB database `next168` (v1), object stores `document`, `backup`, `proposals` and `meta` (`src/repositories/indexedDbStore.ts`). Every operation opens the database, runs one transaction and closes it. Every change is one `readwrite` transaction with `durability: 'strict'` and an explicit `commit()`, resolved only on `complete`; it rejects only from `onabort`, with the first request error as the cause. Calendar texts (`next168-calendars`) use the same strict, committed writes. The UI publishes a change only after its transaction completed.
- **Atomicity.** A save writes the document and the backup of the previous bytes in one transaction. A proposal approval writes document, backup and proposal status in one transaction, so the browser can no longer reach "applied but still pending"; `reject` records a proposal the document already applied as `applied`.
- **One-time import.** When `next168` holds no document and no `meta.migration`, the first load imports `next168-v2` (+ backup + proposals, byte for byte; tester builds) or else migrates `next168-data` (v1), in one transaction together with `meta.migration`. localStorage is never written or modified by the import. After an import, localStorage is never read again; a missing document with `meta.migration` present is the recovery screen (`stored-document-missing`), never a second import. Edits made later in an older tab are not imported (the existing "older version" banner says so).
- **D4 amended.** Cross-tab change notification is a `BroadcastChannel('next168-storage')` message after each commit, plus a re-check on `focus` and on becoming visible. Delivery is best effort; every commit is a compare-and-swap under the `next168-commit` Web Lock, so a stale tab can show old data but cannot overwrite newer data. A failing re-check read surfaces the storage error screen.
- **Delete-all.** Inside ONE hold of the `next168-commit` lock: compare-and-swap, one transaction that writes the fresh document, deletes backup and proposals, records `meta.purge` and increments `meta.purgeEpoch`; then, still under the same hold (never a nested lock request), the five legacy localStorage keys and the listed calendar texts not referenced by the current document are removed and the purge record is emptied. Any interrupted step resumes on the next load. Without Web Locks the app is read-only and a pending purge stays pending: nothing is written or removed without the lock.
- **Calendar writes and delete-all.** Every calendar operation captures `meta.purgeEpoch` when it starts. Its text write, its rollback and its document commit run only while the epoch is unchanged (the text writes under the commit lock; the commit as a CAS that also checks the epoch), so a refresh that started before a delete-all writes nothing after it. Delete-all also cancels the refreshes the current tab has in flight. Residual window: a tab killed between a calendar text write and its own rollback can leave an unreferenced text, as before this revision.
- **Storage failure.** IndexedDB missing, blocked or failing on read sets status `error`; a write that fails on storage (quota, abort, unknown) sets it too, from saves, delete-all, recovery and proposal approval. The app then shows a blocking screen with "Try again" and, when a document is in memory, "Export a copy" of the last committed document. The proposal review sheet, mounted outside the shell, closes. Planner data is never written to localStorage.
- **Not guaranteed.** `strict` is a durability hint: survival of an app or browser process kill after the change is visible is what A1 (Android emulator) and A2 (desktop SIGKILL) check. Private or ephemeral sessions discard data at session end; power loss can still lose the last change.
- **Rollback (before public launch).** Rollback is a code revert; no reverse migration exists or is rehearsed. The reverted build reads its own localStorage, which this build never modified, so edits made in the IndexedDB build are not visible after a revert, and edits made after a revert are not re-imported by a later roll-forward (the IndexedDB document already exists). Moving data across a revert is manual: Settings → Data → Export, then Import in the other build. That transfer carries the planner document and the readable calendar texts only; pending proposals and the backup are not exported, and import leaves the destination's proposals unchanged. It is not a complete store rollback. Production v1 users keep `next168-data` until they choose "Delete everything". A rollback after public launch needs its own reviewed design.
- **Companion mode** is unchanged; the assistant proposal card and the Data import read-back now use the active mode's repository, so companion mode never opens `next168`. Its calendar services still default to browser IndexedDB (pre-existing, declared).

## 8. Risks

- Scope is large for one deliverable; S1–S5 run in parallel only because paths are disjoint and contracts are fixed first. Any slice that needs a contract change sends it back to the architect.
- WebGPU in headless CI is unavailable; real-model verification happens locally and is labelled as such.
- A physical phone install cannot be operated by an agent; the emulator run is the evidence, the owner's own phone remains an owner check.
- `ical.js` licence (MPL-2.0) is compatible as an unmodified dependency; confirm at install time.
