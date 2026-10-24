# Open-source, local-first and LLM-connected planners: research for Next168

Research date: 2026-10-24 (all "accessed" dates below). Epic: crexative/next168#3.
Method: public GitHub pages and release feeds fetched on 2026-10-24, plus web searches. Star counts are the rounded figures GitHub shows on the repo page. Anything I could not verify is marked **UNKNOWN** with the reason.

## 1. Summary

- **The closest model for Next168 is Super Productivity (MIT, ~23.1k stars).** It is local-first with no account, has a plugin system, and its v19.3.0 (2026-10-23) ships an **opt-in local MCP endpoint**, plus a local REST API. That is the same shape the owner wants: data on the device, the user's own LLM app connected to it.
- **Nobody ships an on-device model inside a planner that I could verify.** Search found only generic browser-LLM runtimes (WebLLM, MediaPipe/Gemma). No planner was found that bundles one. This is an opening, but also a risk (no reference implementation to copy).
- **LLM connectivity today is mostly "MCP server beside the app".** Official or popular servers (Todoist, Google Calendar community server, Super Productivity community servers, ActivityWatch) are local processes or hosted OAuth endpoints. Human control over writes is weak almost everywhere: it comes from exact-ID tools, tool allow-lists and the MCP client's own approval prompt, not from an in-app confirm step.
- **WebMCP** (`navigator.modelContext`) is the only route where a *web-only, no-install* app like Next168 can expose tools. It is a Community Group draft, Chrome-only preview, and secondary sources say mainstream agents do not call it yet. Treat as a bet, not a dependency.
- **Licence trap:** most mature competitors are copyleft (Vikunja AGPL/GPL, Kimai AGPL, Tasks.org GPL-3, Planify GPL-3, ActivityWatch MPL-2.0). Next168 is MIT: borrow ideas, not code, from those. Safe-to-read-and-reuse code is MIT: Super Productivity, obsidian-day-planner, AFFiNE (community edition), and the MCP servers by nspady, nicola-lunghi and 8bitgentleman.
- **Top recommendations (details in section 4):** schema-versioned storage + migrations, JSON export/import with a versioned envelope, ICS export/import, PWA offline install, an MCP connector via a tiny local bridge with an in-app "pending changes" approval queue, multi-profile.

## 2. Project table

Stars/licence/last release as observed 2026-10-24. "Last release" = newest entry in the repo's release feed (`releases.atom`); a pre-release/canary is noted where that is all that exists.

| Project | Licence | Stars | Last release (date) | Storage | LLM integration |
|---|---|---|---|---|---|
| Super Productivity | MIT | ~23.1k | v19.3.0 (2026-10-23) | Local app data; user picks sync: SuperSync (E2E-encrypted, self-hostable), Dropbox, WebDAV. No account. | Opt-in local MCP endpoint (v19.3.0 notes); SuperSync hosted task capture with ChatGPT OAuth; local REST API; many community MCP servers |
| Vikunja | AGPL-3.0-or-later (`desktop/` GPL-3.0-or-later) | ~5.8k | v2.7.1 (2026-10-20) | Server DB (backend list UNKNOWN: not on the page I read) | None found in repo page |
| Kimai | AGPL-3.0 | ~5.1k | 2.70.2 (2026-10-21) | MariaDB >= 10.6 / MySQL >= 8.4 | None found. Plugin system + marketplace exists |
| ActivityWatch | MPL-2.0 | ~19.4k | v0.14.2b1 pre-release (2026-10-22); v0.14.1 (2026-10-10) | Local, bucketed events; sync via a folder (Dropbox/Syncthing) is work in progress; JSON export per bucket or full | Third-party MCP server (read-only tools, section 5) |
| obsidian-day-planner | MIT | ~2.7k | 0.35.1 (2026-07-31) | Markdown in the Obsidian vault (daily notes, Tasks plugin); time tracking as Dataview properties | None found. ICS URLs (Google/iCloud/Outlook) can be shown read-only |
| Tasks.org | GPL-3.0 | ~5.7k | 15.13 (2026-10-14) | Not stated on page read (UNKNOWN) | None found |
| Planify | GPL-3.0 | ~5.8k | 4.20.0 (2026-09-10) | Not stated (UNKNOWN); Todoist, Nextcloud, CalDAV backends; GNOME (libecal) | None found |
| AFFiNE | MIT (Community Edition) | ~73.8k | Only canary builds in feed (2026.10.23-canary.908); stable UNKNOWN | Local-first on disk; YJS CRDT (y-octo, OctoBase) | None found in README |
| Anytype (client) | "Any Source Available License 1.0" (not OSI open source) | ~9.0k | v0.57.4 (2026-10-03) | Local, optional P2P sync, zero-knowledge via any-sync | gRPC API and "Agents" mentioned; no MCP statement |
| Org-mode agenda | GPL (not verified) | UNKNOWN (not on GitHub; orgmode.org unreachable from this environment) | UNKNOWN | Plain-text files | UNKNOWN |
| Todoist (reference, not OSS app) | MCP repo licence UNKNOWN (README silent) | n/a | n/a | Cloud | Official MCP (hosted + local) |

Notes: Logseq, Obsidian core and Things / TickTick / Apple Reminders MCP servers were **not** researched in depth (time budget); only the sources above were verified. No notable brand-new GitHub planner was identified; that gap is UNKNOWN, not "none exist".

## 3. What changed in the last 3 months (2026-07-24 to 2026-10-24)

Verified from release feeds:
- **Super Productivity** shipped v19.1.0 (2026-09-19), v19.2.0 (2026-10-11) and v19.3.0 (2026-10-23). v19.3.0 notes: opt-in local MCP endpoint, hosted task capture via SuperSync with ChatGPT OAuth, assistant-created tasks can carry schedules/repeat rules, in-app install of community plugins, CalDAV task create/delete sync, WebDAV now asks before overwriting remote changes it cannot decrypt, local REST API gained notes, counters and daily time-log corrections, mobile keeps the last full backup. **UNKNOWN:** in which of the three releases the MCP endpoint first appeared (I read only v19.3.0 notes).
- **Vikunja** v2.7.0 (2026-10-02) and v2.7.1 (2026-10-20). **Kimai** 2.70.1/2.70.2 (2026-10-21). **ActivityWatch** v0.14.1 (2026-10-10) and a v0.14.2 beta (2026-10-22). **Tasks.org** 15.13 (2026-10-14). **Anytype** v0.57.x (2026-10-03). **Planify** 4.20.0 (2026-09-10). **obsidian-day-planner** 0.35.0/0.35.1 (2026-07-29/31, at the edge of the window). Release *contents* for these were not read: UNKNOWN.
- **WebMCP:** per secondary sources (not the spec; spec site unreachable here), the draft is a Web Machine Learning Community Group report, not a W3C standard; a post says the text was last published 2026-08-26; Chrome preview/origin trial reported around Chrome 149-156; one source claims a rename from `navigator.modelContext` to `document.modelContext`, which I could not confirm. Sources disagree, so exact API name is UNKNOWN.
- The unofficial Super Productivity MCP servers multiplied (at least four distinct repos in search results). Dates of their creation: UNKNOWN.

## 4. Ranked features and patterns for Next168

Context: Vue 3 + TS + Pinia, localStorage behind `src/repositories`. Effort S = days, M = 1-2 weeks, L = multi-week. "Who" is who was verified doing it; items without a verified source are marked as design recommendations.

| # | Feature / pattern | What it is | Who does it | Fit with Next168 | Effort | Licence note |
|---|---|---|---|---|---|---|
| 1 | **Versioned storage schema + migrations** | Store `{schemaVersion, data}`; on load run ordered migration functions; keep a pre-migration backup copy | Super Productivity's release notes mention recovery of unmigrated v12-or-older data and keeping the last full backup, which shows the failure mode | Add a version field to the `next168-data` payload and a `migrate()` chain in the repository layer before the Pinia store hydrates. Prerequisite for every item below | S | Own code; no reuse needed |
| 2 | **Versioned JSON export / import ("backup")** | Download/restore one JSON file with an envelope (`app`, `schemaVersion`, `exportedAt`) | ActivityWatch (JSON per bucket or full); Super Productivity (backups) | `exportData()`/`importData()` on the repository interface, validated by the existing `ValidationService`; confirm before overwrite (SP now asks before overwriting remote it cannot decrypt) | S | Own code |
| 3 | **MCP connector for the user's own LLM app, writes held for approval** | Local MCP server exposing planner tools; write tools create *proposals* the user accepts in the Next168 UI | Super Productivity (opt-in local endpoint, v19.3.0); community servers with exact-ID writes | Next168 is a pure browser app and cannot host a server. Options: (a) small optional local bridge (Node, MIT) that talks to the open page over WebSocket/BroadcastChannel; (b) WebMCP in-page tools (item 11). Expose the tool surface in section 5; store proposals in a `pendingChanges` Pinia slice | L | Reuse patterns from MIT servers (nspady, nicola-lunghi, 8bitgentleman); do not copy any GPL/AGPL code |
| 4 | **ICS export / import** | RFC 5545 `.ics` files so blocks show in Google/Apple/Outlook calendars and external events import as blocks | obsidian-day-planner (read-only ICS URLs); Tasks.org/Planify via CalDAV (not verified in detail) | Export: map `TimeBlock` to VEVENT (weekly `RRULE` for repeats). Import: parse VEVENT into blocks, read-only "busy" overlay first. Needs a small MIT parser (e.g. `ical.js`, licence to be confirmed before adding) | M | Parser licence UNKNOWN until checked; do not borrow from GPL planners |
| 5 | **PWA install + offline** | Web manifest + service worker so the app installs and works with no network | Super Productivity ships a web app too; PWA support in others UNKNOWN | Vite PWA plugin, precache build, offline-first by design already since data is localStorage. Aligns with "works locally" goal | S | Own code / MIT plugin |
| 6 | **Multi-profile on one device** | Several named planners (work/personal/family) | Not verified in any project I read; design recommendation | Namespace the storage key (`next168-data:<profileId>`) in the repository; profile switcher in header. Depends on #1 | M | Own code |
| 7 | **Time tracking against planned blocks** | Start/stop timer, "planned vs actual" per category | Super Productivity (timeboxing + tracking); obsidian-day-planner (clock-in/out, experimental); Kimai; ActivityWatch (automatic) | Fits the 168h idea directly: add `actualMinutes` per block and a plan-vs-actual chart in StatsDashboard | M | SP and day-planner are MIT, so ideas or code may be reused with attribution; Kimai (AGPL) ideas only |
| 8 | **Plain-text / Markdown export of the week** | Human-readable week (and Obsidian-friendly) | obsidian-day-planner stores Markdown task lines; Org-mode (agenda from text; not verified) | Export button producing `- [ ] 09:00-10:30 Title #category` lines; one-way is enough | S | Format idea only |
| 9 | **Encrypted optional sync (later)** | Bring-your-own storage: WebDAV/Dropbox/file, E2E encrypted | Super Productivity (SuperSync E2E, WebDAV, Dropbox); Anytype (any-sync); AFFiNE (YJS CRDT) | Out of scope for "everything local for now", but design the repository so sync is a swappable backend. Consider File System Access API as a no-server first step | L | SP is MIT; Anytype licence is source-available, not reusable |
| 10 | **Plugin / extension hooks** | Safe extension points for community add-ons | Super Productivity (in-app install of community plugins); Kimai (marketplace); ActivityWatch (watchers) | Not now. Premature for a small app; keep stores/services clean enough to add later | L | Avoid |
| 11 | **WebMCP in-page tools** | Register tools via the browser so an agent in the page's browser can call the planner | Chrome preview only; no planner verified | Wrap store actions (`addTimeBlock`, ...) as tools behind a feature flag; reuse the proposal queue from #3. Behind a flag because spec name/status unsettled | M | Spec is a draft; no code copied |
| 12 | **On-device assistant (Gemma class) in the browser** | Local small model parses "block 2h for gym on Tuesday" into a proposed change | No planner found shipping this. Runtimes exist: WebLLM (WebGPU), MediaPipe LLM Task for Gemma (search results, not primary docs) | Lazy-load model only after explicit opt-in, run in a Worker, output only *structured proposals* that go through #3's approval queue and `ValidationService`. Needs WebGPU; model size/RAM figures UNKNOWN (not verified) | L | Check each model's licence (Gemma terms) and runtime licence before shipping; not verified here |
| 13 | **Privacy-first analytics** | Count usage without identifying people, or none at all | Super Productivity states it collects no data and needs no account | Recommend no analytics, or a self-hosted cookieless counter; no verified source for a specific tool, so I name none | S | n/a |
| 14 | **Natural-language quick-add** | "gym tue 7am 1h" parsing | Todoist tool schema accepts `dueString` natural language and `duration` strings; SP "quick add" in a community bridge | Deterministic parser first (cheap, offline), LLM as optional fallback | M | Own code |
| 15 | **Read-only "busy" calendar overlay** | Show external events greyed on the grid | obsidian-day-planner (ICS URLs) | Builds on #4 import; shows conflicts without owning external data | S | Own code |

Ranking logic: foundations first (1, 2), then no-account distribution (5), then the owner's headline goals (3, 4, 12 with the safety rails of 3), then nice-to-haves.

## 5. MCP tool surfaces of the best LLM-connected projects

Picked for relevance to Next168 (planner/calendar, with different safety models). Names/arguments are exactly as read from the sources on 2026-10-24. "Not documented" means the source did not give them.

### 5.1 Todoist AI (Doist/todoist-ai), official

Install: hosted Streamable HTTP `https://ai.todoist.net/mcp` with OAuth (Claude Desktop custom connector, Claude Code, VS Code, others via `mcp-remote`), or local `npx @doist/todoist-mcp` with `TODOIST_API_KEY`. Licence: README silent (UNKNOWN). No documented confirm/read-only mode; README advises a test account for writes.

Tool files in `src/tools` (exposed names are constants in `utils/tool-names.js`, not read, so exact wire names are UNKNOWN; file names are listed): add-comments, add-filters, add-labels, add-projects, add-reminders, add-sections, add-tasks, analyze-project-health, complete-tasks, delete-object, export-project-template, fetch-object, fetch, find-activity, find-comments, find-completed-tasks, find-filters, find-labels, find-project-collaborators, find-projects, find-reminders, find-sections, find-tasks-by-date, find-tasks, get-overview, get-productivity-stats, get-project-activity-stats, get-project-health, get-workspace-insights, import-project-template, list-workspaces, manage-assignments, project-management, project-move, reorder-objects, reschedule-tasks, search, uncomplete-tasks, update-comments, update-filters, update-labels, update-projects, update-reminders, update-sections, update-tasks, user-info, view-attachment.

Arguments (read from source):
- `add-tasks`: `tasks[]` (1..batch limit), each `{content (required), description, priority, dueString, deadlineDate (YYYY-MM-DD), duration, labels[], projectId, sectionId, parentId, order, responsibleUser, isUncompletable}`.
- `update-tasks`: `tasks[]`, each `{id (required), content, description, projectId (or "inbox"), sectionId, parentId, order, priority, dueString ("remove" clears), deadlineDate ("remove" clears), duration, responsibleUser ("unassign"), labels[] (replaces all), isUncompletable}`.
- `complete-tasks`: `{ids: string[] (min 1)}`.
- `delete-object`: `{type: project|section|task|comment|label|filter|reminder|location_reminder, id}`.
- `find-tasks-by-date`: `startDate, overdueOption, daysCount, limit, cursor, responsibleUser, responsibleUserFiltering, labels, labelsOperator` (types not read).
- `user-info`: `{}`.

Lessons: batch arrays, `"remove"` sentinel instead of null, single generic delete tool with an entity enum, `cursor` pagination.

### 5.2 Google Calendar MCP (nspady/google-calendar-mcp), community, MIT

Install: `npx` in the client config with `GOOGLE_OAUTH_CREDENTIALS` (own OAuth client file), local build, or Docker; optional service account. Requires users to create Google OAuth credentials, which is not friendly for non-technical users.
Safety: README says all operations require explicit user consent; `ENABLED_TOOLS` / `--enable-tools` can restrict to read-only tools. Caveat: `create-events` skips conflict detection.

Tools (13): `list-calendars`; `list-events` (date filtering); `get-event` (event ID); `search-events` (text query); `create-event` (optional `eventLabelId`); `create-events` (batch with shared defaults); `update-event` (can set/remove event label); `delete-event`; `respond-to-event` (Accept/Decline/Maybe/No Response); `get-freebusy`; `get-current-time`; `list-colors` (optional `calendarId`); `manage-accounts` (add/list/remove). Most tools accept an `account` parameter. Full argument names beyond those listed: not documented in the README (UNKNOWN).

Note: Google also documents an official Calendar MCP server (found via search result titled "Configure the Calendar MCP server"), but developers.google.com was unreachable here, so its tool list is UNKNOWN.

### 5.3 Super Productivity MCP (nicola-lunghi/super-productivity-mcp), community, MIT

Wraps the app's local REST API (desktop >= 18.x, setting "Enable local REST API"; loopback `127.0.0.1:3876`; no token in 18.16.0) over STDIO. Install: ChatGPT Desktop "Add server -> STDIO" with `npx -y super-productivity-mcp-server`, or Codex config; Node >= 20.

| Tool | Arguments | Writes? |
|---|---|---|
| `health` / `check_connection` | none documented | no |
| `search_tasks` | `query` | no |
| `list_today` | none | no |
| `get_current_task` | none | no |
| `plan_task_today` | `taskId` | yes |
| `start_task` | `taskId` | yes |
| `stop_timer` | none | yes |
| `complete_task` | `taskId` | yes |
| `ensure_github_issue_task` | `issue` (`owner/repo#n` or URL), `planToday` (default false) | yes, idempotent |

Safety model: no confirm dialog; control by design: writes need an exact `taskId` obtained from a prior search, no bulk selection, no background activity, small tool surface. Weakness stated by the README: the 18.16.0 local API has no auth, so any local process of the same user can read/modify tasks.

### 5.4 Also useful: ActivityWatch MCP (8bitgentleman/activitywatch-mcp-server), MIT

Read-only in practice (README does not state it). Tools: `list-buckets` (`type?`, `includeData?`), `run-query` (`timeperiods: string[]`, `query: string[]`, `name?` for caching), `get-events` (`bucketId`, `start?`, `end?`, `limit?`), `get-settings` (`key?`). Argument types are not documented. npm package is "coming soon", build from source; needs ActivityWatch on `http://localhost:5600`.

### 5.5 Proposed Next168 surface (design, not verified elsewhere)

Combining the safest traits: `list_categories`, `list_blocks({day?})`, `get_week_summary`, `find_free_slots({durationMinutes, day?})` (all read); `propose_block({title, categoryId, day, start, end})`, `propose_move_block({id, day, start, end})`, `propose_delete_block({id})`, `propose_category({name, weeklyHourLimit})` (write = create a pending change with an ID, never mutate state); `list_pending_changes`. Acceptance happens only in the Next168 UI (button), not via a tool. Every proposal is validated by `ValidationService` so over-limit or overlapping suggestions are rejected before the user sees them.

## 6. Non-technical installation: what exists today

- Hosted OAuth connector (Todoist): paste a URL into Claude Desktop's custom connector and sign in. Easiest, but cloud-hosted, so not "local".
- STDIO via `npx` (Google Calendar, Super Productivity, ActivityWatch): needs Node, JSON config editing, and (for Google) a self-created OAuth client. Hard for non-technical users.
- Super Productivity v19.3.0's *opt-in endpoint inside the app* is the lowest-friction local pattern seen (a toggle, no separate install), although the exact connection steps for it are UNKNOWN (release notes only).
- For Next168 the equivalent would be a toggle in Settings that shows a one-line connect command or URL; a pure static web page cannot listen for connections, so a bridge or WebMCP is unavoidable (see items 3 and 11).

## 7. Assumptions and unknowns

- Star counts are rounded GitHub UI values on one date; "last release" is the newest feed entry, which can be a pre-release (ActivityWatch v0.14.2b1, AFFiNE canary).
- Repo pages often hid release data, so dates came from `releases.atom`; some feed pages were truncated at 100,000 characters but newest entries come first.
- Licences were read from repo pages through a summarizing fetch tool, not from LICENSE files; verify the file before reusing any code.
- UNKNOWN: Org-mode stats and licence (site unreachable), Vikunja/Planify/Tasks.org storage and ICS details, Kimai export formats, Logseq, Things / TickTick / Apple Reminders MCP servers, official Google Calendar MCP tool list, WebMCP spec text, on-device model sizes, Gemma licence terms, ICS library choice.
- No verified source for "multi-profile" or "privacy-first analytics" in competitors; those rows are recommendations.

## 8. Sources (all accessed 2026-10-24 unless noted)

Repositories and release feeds (release dates as shown in feeds):
- Super Productivity: https://github.com/super-productivity/super-productivity ; https://github.com/super-productivity/super-productivity/releases.atom (v19.3.0 2026-10-23, v19.2.0 2026-10-11, v19.1.0 2026-09-19) ; https://github.com/super-productivity/super-productivity/releases/tag/v19.3.0
- Vikunja: https://github.com/go-vikunja/vikunja ; releases.atom (v2.7.1 2026-10-20, v2.7.0 2026-10-02)
- Kimai: https://github.com/kimai/kimai ; releases.atom (2.70.2 and 2.70.1, 2026-10-21)
- ActivityWatch: https://github.com/ActivityWatch/activitywatch ; releases.atom (v0.14.2b1 2026-10-22, v0.14.1 2026-10-10)
- obsidian-day-planner: https://github.com/ivan-lednev/obsidian-day-planner ; releases.atom (0.35.1 2026-07-31, 0.35.0 2026-07-29)
- Tasks.org: https://github.com/tasks/tasks ; releases.atom (15.13 2026-10-14)
- Planify: https://github.com/alainm23/planify ; releases.atom (4.20.0 2026-09-10, 4.19.5 2026-07-17)
- AFFiNE: https://github.com/toeverything/AFFiNE ; releases.atom (canary 2026-10-23)
- Anytype: https://github.com/anyproto/anytype-ts ; releases.atom (v0.57.4 2026-10-03)

MCP servers:
- https://github.com/Doist/todoist-ai (README and `src/tools/*.ts`: add-tasks, update-tasks, complete-tasks, delete-object, find-tasks-by-date)
- https://github.com/nspady/google-calendar-mcp (README)
- https://github.com/nicola-lunghi/super-productivity-mcp (README)
- https://github.com/8bitgentleman/activitywatch-mcp-server (README)
- Search-result listings (secondary): glama.ai and playbooks.com pages for rochadelon / organicmoron / maystar / PatrickFanella Super Productivity MCP servers; mcpservers.org for ActivityWatch MCP servers; https://developers.google.com/workspace/calendar/api/guides/configure-mcp-server (title seen in search only, page unreachable).

WebMCP and on-device (secondary, unverified against spec):
- https://webmachinelearning.github.io/webmcp/ (spec; unreachable from this environment)
- https://patrickbrosset.com/articles/2026-02-23-webmcp-updates-clarifications-and-next-steps/ ; https://dev.to/studiomeyer_io/webmcp-reality-check-where-the-spec-actually-stands-4gh1 ; https://codex.danielvaughan.com/2026/10/15/webmcp-browser-native-model-context-protocol-navigator-modelcontext-agent-web/ (2026-10-15)
- WebLLM: https://github.com/mlc-ai/web-llm ; https://arxiv.org/html/2412.15803v1 (paper, listed in search results)
