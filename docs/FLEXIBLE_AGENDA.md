# Dated planning pilot — 2026-10-05

Baseline: `05d781d9a884db89d0c42d87d6e9cdd364bd4a5c` (fresh isolated clone).
Runtime: Vue 3 / Pinia / TypeScript, static Vite build, browser localStorage.
No AGENTS.md or .agents/skills exists in this repository. CLAUDE.md and
ARCHITECTURE.md informed the component → store → validation → repository flow.

## Research and design handoff

Observed: routine blocks have weekdays, not dates or completion state. There is
no active backend, auth, calendar or LLM. Corrupt JSON previously returned null
and triggered sample-data replacement. Baseline tests covered five validation
cases only. Daily usage, loss frequency and planning time are UNKNOWN.

Minimal design: preserve the weekly routine and statistics; add an independent
versioned dated agenda under `next168-agenda-v1`. Explicitly instantiate routine
for one date with stable origin/date IDs. Stats remain planned routine allocation,
not completion or confirmed reservations. Agenda times are same-day only, dates
2000–2099, timezone America/Bogota. Work Mon–Fri 08:30–17:00/17:30 is advisory,
not a blocked interval. Actual dated commitments are checked for overlaps.

An isolated researcher/architect inspected the current source before implementation.
A separate verifier reviews the implementation and reruns checks. No business vault
or commercial priorities are required to run this personal planner.

## User workflow

1. Keep your weekly routine in Calendar, then open **Agenda** and select a date.
2. Optionally copy that date's routine. Repeating this does not duplicate it.
3. Create a task, meeting, reserved class/booking or reminder. Planned, reserved,
   done and cancelled are separate states. Done is a personal declaration; it
   does not verify a payment, booking or other external action.
4. Edit/reschedule the same dated item. Notes, list, budget and ID remain attached.
   A reservation can be edited explicitly by the user; conflicting changes fail.
   Dinner/disconnection can move for one date without changing the weekly series.
5. Choose only meetings, bookings or reminders for Calendar. Review the preview,
   then download ICS for manual import. Routine tasks are never exported.
6. Download the complete versioned JSON backup. Restore requires validated file
   preview and an explicit replacement checkbox. The previous primary values,
   including corrupt originals, are preserved as recovery copies.

The new UI is translated to Spanish and English; other locales use the existing
English fallback. Domain validation errors currently use English.

## Persistence and recovery

`next168-data` remains the legacy routine format. Load/import validate structural
integrity and recalculate durations. Corruption blocks mutations and preserves the
original. A failed save is surfaced; legacy routine edits may remain unsaved in
memory and should be downloaded before leaving. Agenda commits apply only after a
successful save. Existing valid values are saved to `*-backup` before replacing the
primary. Stale tabs cannot overwrite a newer primary; reload before retrying.

Full backup: `{schemaVersion:1, agenda, routine}`. Restore validates before writes,
saves `*-recovery` originals, and rolls back primaries if the second write fails.
A rollback failure blocks agenda writes and reports recovery copies. This is local
storage, not cloud sync; browser clearing/device loss still requires a downloaded
backup. Export history belongs in the backup, so restoring an older backup can
restore older deduplication history. Manual review remains required.

## Safe LLM / MCP boundary

The expandable assistant panel provides a JSON request. Nothing is sent by the
app; copying it to an assistant is an explicit user action. A local synthetic
proposal demonstrates the same path. No API key belongs in a Vite/browser bundle.

Request: `schemaVersion`, `baseRevision`, `timezone`, `calendarAccess: unavailable`,
`externalAvailability: unknown`, flexible work window and dated items.
Response must have exactly:

```json
{"schemaVersion":1,"baseRevision":"current-revision","moves":[
  {"id":"existing-item-id","date":"2026-10-06","startTime":"18:00","endTime":"19:00"}
]}
```

Reject unknown fields, stale revisions, duplicate/missing IDs, invalid dates,
overnight intervals, commitments, done/cancelled items, and conflicts in the whole
result. Only flexible pending tasks/reminders may move. Preview precedes apply;
apply validates again against current state and writes the complete result once.
Notes/list/budget are preserved by a move. There is no tool execution, remote
availability inference or Calendar writing capability in this contract.

A future adapter must authenticate outside the static bundle, read explicitly
chosen calendars, limit data disclosure, retain event IDs and validate revisions,
reviewed changes and conflicts again before writes. Credentials, persistent OAuth,
paid services and security configuration require separate user authorization.

## Calendar boundary

ICS uses UTC timestamps derived from Bogotá, stable UID, RFC 5545 text escaping,
CRLF and UTF-8 folding. Local export fingerprints skip unchanged prepared events.
A prepared file is not evidence of import or delivery. Changed items remain
reviewable with the same UID; Google manual import is not synchronization and may
create duplicates. Cancellations and completion do not update external events.
Notifications, attendees and conferences are not generated or verified. Avoid
reimporting changed events blindly; update the original manually.

Sources checked 2026-10-05:
- [Google import guidance](https://support.google.com/calendar/answer/37118)
- [Google event creation/authentication](https://developers.google.com/workspace/calendar/api/guides/create-events)
- [RFC 5545](https://www.rfc-editor.org/rfc/rfc5545.html)

## Personal validation pilot

Applied the explicitly requested source-command-validate-idea and its existing
project YC audit. The separate Spanish audit is a review working document outside
Git, not canonical vault knowledge or proof of market validation. No Next168
CONTEXT/KPI entry was found in the consulted personal memory.

Problem hypothesis: adjusting a pending plan while preserving commitments is
costly enough that Johan will repeatedly use this workflow. Proposed value:
reschedule the same item without losing context or polluting Google Calendar.
Following [Do Things That Don't Scale](https://paulgraham.com/ds.html), test with
one user's concrete decisions before adding services or pursuing distribution.

One proposed metric: days with at least one useful dated planning decision in
seven days; target ≥4/7. Baseline UNKNOWN; proposed review 2026-10-12, not scheduled.
A useful decision is a real task reprogrammed, commitment clarified or chosen event
prepared, with Johan confirming its utility. Passing synthetic tests does not count
as real usage, productivity improvement, market demand or retention.

## Verification and limits

Run `npm test -- --run`, `npx eslint .`, `npm run build` and `git diff --check`.
Tests mount the actual Vue agenda and exercise forms, proposals and restore with
synthetic fixtures. They also cover corrupted storage, quota failures, stale tabs,
restore rollback, conflicts, selected ICS and metadata preservation. No private
mail/financial fixtures or real calendar writes are used.

Chromium headless exercises the production preview at 127.0.0.1 in isolated
contexts, with outbound traffic blocked. Desktop 1280×900 and mobile emulated
390×844 cover repeated rescheduling, corrupt/valid backup restore, discarded/stale
and cancelled-item proposals, and repeated selected ICS download. Screenshots were
inspected locally. This verifies the tested browser paths and local download, not
an iPhone/device, external importer, notification delivery, live LLM/MIA execution
or real user productivity. The preview server terminates after the test run.
Legacy weekly overnight overlap behavior is unchanged; the dated agenda rejects
cross-midnight copying rather than silently scheduling an invalid interval.


## Headless test setup and dependency remediation

`npm ci --ignore-scripts` installs the pinned official Playwright test dependency.
Download its official browser inside the workspace, then run the production tests:

```sh
PLAYWRIGHT_BROWSERS_PATH=.browser-cache npx playwright install chromium
npm run build
npm run test:e2e
```

The browser cache is ignored by Git. Tests are always configured headless, use a
fresh context per test, block non-local requests and never attach to a user's
browser. The test runner owns its temporary localhost preview and refuses to reuse
an existing server. Screenshots/ICS/JSON evidence stays outside this checkout.
`npm run type-check` checks both application and E2E TypeScript.

The two original production-tree audit findings were PostCSS 8.5.6 and Nano ID
3.3.11. Compatible patch updates resolve them: PostCSS 8.5.29, Nano ID 3.3.20;
the existing Vue devtools Nano ID 5 line separately moves 5.1.6→5.1.16. Package
hoisting changed location, not consumers' major versions. Source-map-js moves
1.2.1→1.2.2 through the same compatible resolution. No framework migration,
force audit fix, credential or persistent-security configuration was introduced.

Although npm includes PostCSS through Vue/compiler-sfc in its production tree,
the inspected production Vite module graph contains no PostCSS, Nano ID or SFC
compiler modules. These findings affect build/tooling inputs rather than direct
browser-planner calls. `npm audit --omit=dev` now reports zero findings. The original full development tree reported 31 findings, then 29 after those
production fixes. A subsequent targeted compatible tooling pass reduces it to
7 findings: zero critical, four high and three moderate, representing two residual
root advisories. Vitest/UI3.2.7, Vite7.3.6, happy-dom20.14.5 and transitive patches
remove the critical and most high findings. No new advisory was introduced.

Residual high: eslint-config14.9.0→fast-glob3.3.3→micromatch4.0.8→braces3.0.3,
with no published braces patch. Current lint uses fixed globs/static escaped
ignores; planner input cannot supply glob patterns. CI build does not run lint.
Residual moderate: Vitest3.2.7→mocker3.2.7. Configured happy-dom tests do not enable
the vulnerable browser redirect plugin; future UI/browser/custom-plugin exposure
needs review. Patched Vitest/UI4.1.11 requires an explicit major migration and
renewed verification; npm's eslint-config14.0.1 downgrade is not a safe patch.
The existing dev server host:true setting is unchanged. Tests use127.0.0.1 only.
Production audit zero does not establish total tooling security or justify
publishing. Complete baseline comparison, dependency routes, exposure and
migration risks are in the accompanying development-security-review.md evidence.

Primary advisory/configuration sources checked 2026-10-05:
- [PostCSS security advisories](https://github.com/postcss/postcss/security/advisories)
- [Nano ID security advisories](https://github.com/ai/nanoid/security/advisories)
- [Playwright isolated test configuration](https://playwright.dev/docs/test-use-options)
