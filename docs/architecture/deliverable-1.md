# Next168 deliverable 1 — architecture

Epic: [#3](https://github.com/crexative/next168/issues/3) · GOAL: [deliverable 1](https://github.com/crexative/next168/issues/3#issuecomment-6379989364) · Architect: MIA coordinator (Claude Opus 5.5), 2026-10-24 · Status: **draft for adversarial review**.

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

## 7. Risks

- Scope is large for one deliverable; S1–S5 run in parallel only because paths are disjoint and contracts are fixed first. Any slice that needs a contract change sends it back to the architect.
- WebGPU in headless CI is unavailable; real-model verification happens locally and is labelled as such.
- A physical phone install cannot be operated by an agent; the emulator run is the evidence, the owner's own phone remains an owner check.
- `ical.js` licence (MPL-2.0) is compatible as an unmodified dependency; confirm at install time.
