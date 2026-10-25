# Planner core

Framework-free domain functions shared by the browser and Node companion. `model.ts` is the frozen contract. Callers own persistence, serialization locks, UI approval, calendar expansion and external busy overlays.

## Documents and imports

- `createEmptyDocument(env)` accepts `{ now: Date, locale, timeZone, tutorialCompleted?, idGen? }`. Workspace ids default to `crypto.randomUUID()`; inject `idGen` for deterministic fixtures.
- `parseDocument(json)` returns `LoadResult`; `null`/`undefined` mean absent storage, while malformed or empty strings are corrupt. `validateDocument(value)` throws for invalid schema or semantics. Identity uniqueness is per collection; actual identity normalizes `plannedStartAt` to an instant. Actual snapshots may reference deleted categories or blocks.
- `migrateToCurrent(raw, env)` accepts parsed v1/v2 values or JSON and returns `LoadResult`, with `migratedFrom: 1` on successful legacy migration. It does not read or write storage. Legacy `#RRGGBB` category colors are retained exactly and `#RGB` is expanded; both are matched to the visual specification's light palette by squared RGB distance, and any other legacy color text maps to `gray` without `customColor`. All-day events must span at least one local date (exclusive end), the same rule the ICS export enforces.
- `nextRevision(document, clock)` validates and returns a new document; it does not mutate the input or save it.
- `buildExportBundle(document, sourceTexts, clock)` requires a `Record<sourceId, rawIcsText>` for every calendar source, rejects unknown sources and caps each text at 5 MiB of UTF-8. `parseExportBundle(json, migrationEnv?)` returns `{ kind: 'ok', bundle, document, migratedFrom? }`, `corrupt`, or `unsupported`. Bare legacy files require the explicit migration environment so importing never uses a hidden clock or device settings.
- `await bundleHash(bundle, hash?)` hashes canonical document content and source texts, excluding the transient export timestamp. Export again after import and compare hashes to verify read-back.

## Time, planning and measures

- `occurrences(block)` returns midnight-split, half-open `{start, end, day}` intervals on the Sunday-based 10,080-minute week ring; `overlaps(a, b)` tests these nominal intervals.
- `zonedInstant(localDate, minute, timeZone): Date` implements compatible DST resolution using `Intl`: gaps shift forward and folds select the earlier instant. `localDateOf(instant, timeZone)` and `addLocalDays(date, amount)` handle civil dates without the host's local zone.
- `datedOccurrences(document, fromDate, days, timeZone)` returns full `{blockId, categoryId, title, date, start, end, plannedMinutes}` occurrences intersecting the requested local-date range, including a previous night's spillover. `start`/`end` are ISO instants; `date` is the starting local date. Collapsed gap intervals are omitted. Range lengths are 1–366 days.
- `currentAndNext(document, now, timeZone)` returns `{current, next}`; the current occurrence adds `minutesLeft` (rounded up) and fractional `progress`. An eight-date lookahead includes the next weekly recurrence.
- `scheduleTasks(input: ScheduleInput)` uses the frozen signature. It returns one `TaskPlacement` for each unfinished task. Days are local dates beginning today (seven by default). It merges overlapping category windows, subtracts caller busy intervals and document events, excludes past time, and shares placed capacity across categories. A task with no `categoryId` fits any free time: its windows are every moment of the horizon that no routine block covers (`taskWindows` in `schedulingWindows.ts`; `scheduleStable` uses the same windows). It orders tasks by due date, priority (1 highest), creation instant and id, then fills earliest free windows in chunks of at least ten whole minutes, except that a shorter chunk may finish the task (at least min(10, remaining) minutes). A task is late when overdue now or any chunk ends after its due date's exclusive midnight. Unscheduled minutes remain `overflowMinutes`.
- `fitTasks` (`scheduleStable` in `scheduling.ts`) is what the screens use: the same rules as `scheduleTasks` for each task, plus the five-minute grid, kept (`previous`) and pinned placements and the deadline fallback to free time. It works out the routine occurrences once per call and the free time once per category, then carves each placement out of it, so a fit costs about the same per task at 1,000 tasks as at 50. Zone formatters are shared per time zone (`time.ts`); nothing else is cached between calls. `__tests__/schedulingPerf.test.ts` holds the golden placements recorded from the per-task algorithm (kept as `__tests__/referenceScheduling.ts`), a seeded equivalence test, and the operation-count and wall-time budgets; `npm run perf` prints the reference-machine timings.
- `plannedMinutesByCategory(document)` and `computeStats(document)` use nominal weekly durations. Overlaps remain separate planned occurrences; unassigned hours have a floor of zero. Goal statuses carry minute differences.
- `planVsActual(actuals)` aggregates immutable snapshots, including removed categories: done counts planned elapsed minutes, partial counts actual minutes, skipped counts zero.
- `sevenDayMeasures(checkIns, throughDate, exerciseTarget, timeZone?)` covers seven dates ending inclusively at `throughDate`. A sleep check-in uses its waking date; a later bedtime belongs to the previous date. Pass the document's zone for elapsed DST-aware sleep, or omit it for nominal totals. Missing values return `null`, including per-day states. Display bands: sleep 7–9 h good, 6–10 h amber, otherwise bad; stress 1–2 good, 3 amber, 4–5 bad; exercise yes/no/not-planned maps to good/bad/amber. Work ending at/after 21:00 or before 05:00 is late. These bands are display defaults.

## Proposals and assistant context

- `await canonicalContentHash(ops, hash?)` produces a canonical JSON SHA-256 digest. `Hasher` accepts the canonical string and returns a digest string or promise; the default uses standard Web Crypto in both environments.
- `await buildProposal(input, document, source, clock, idGen, hash?)` validates model input and binds its original workspace/revision. It throws for invalid input. Operations are parsed into an independent snapshot; proposal persistence remains outside the document.
- `await previewProposal(document, proposal, hash?)` verifies identity, revision, status and hash, stages all operations, then returns `{valid, changes: [{op, before, after}], warnings, reason?}`. Preview-only ids are synthetic. Overlap and max-goal warnings do not block.
- `await applyProposal(document, proposal, idGen, clock, hash?)` returns `applied` with a new document and updated proposal, `rejected` with a reason, or `already-applied` with the unchanged document. All operations validate together. The content change increments revision and appends its proposal id atomically to the candidate's last 200 ids. The repository must commit that candidate under its write lock before saving proposal status or publishing UI state.
- `assistantContext(document, {includeNotes?: boolean})` returns compact JSON containing workspace/revision, settings, categories, blocks, tasks and computed stats; block notes are excluded by default. `proposalJsonSchema()` returns `z.toJSONSchema(proposalInputSchema)`.

## Calendar export

`calendarExport(events, clock)` returns an RFC 5545 calendar with UTC timed events, exclusive DATE ends for all-day events, deterministic event-id UIDs, attendees, escaped text, and UTF-8-safe folding at 75 octets including continuation whitespace. All-day events must span at least one local date; their ISO strings' date components are retained.

`googleCalendarUrl(event)` and `outlookCalendarUrl(event)` produce encoded compose links. They do not contact a calendar service. Google documents its template fields; Microsoft publishes compose examples through Q&A rather than a stable API contract. Attendee prefill (`add` / `to`) remains subject to vendor/account behavior; ICS is the portable attendee-bearing export. Real account imports remain the owner's acceptance check per architecture §7.

## Verification

Run `npx vitest run --coverage src/core`, `npm run type-check`, and `npx eslint src/core`. The coverage report's `src/core` row is the slice's measure; the default Vitest configuration also lists unrelated untested app files. Run the core suite with `--environment node` to exercise the companion environment as well. No browser flow or Playwright spec belongs to this pure-core slice.

## Contract incompatibility retained for recovery

The legacy block editor accepts titles up to 100 characters; the v2 schema allows 120, so every v1-valid title migrates intact, and a longer one returns `corrupt` with the original raw input rather than being truncated. Legacy colors were free text: `#RGB`/`#RRGGBB` are kept as `customColor`, anything else migrates to the gray palette color. The v2 collection limits are enforced without truncation.
