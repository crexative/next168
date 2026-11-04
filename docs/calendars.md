# Calendars (S3)

Architecture: `docs/architecture/deliverable-1.md` §7, including Revision 3. ICS calendars need no OAuth and no account access. The one exception is the read-only Google Calendar connection below (owner approval 2026-10-26); Weeklid performs no calendar writes. Provider compose links open the user's provider UI; downloading an ICS file is the portable export. Attendee prefill in Google/Outlook remains subject to vendor/account behavior. Importing into an actual account is an owner check.

## Integration contract

The shell discovers `src/features/calendars/index.ts`, which registers the Calendars Settings section. It does not replace S1's Today/Week views or change shared contracts.

S1 should import `CalendarOverlay` and/or `useCalendarEvents` from `@/features/calendars`. Pass a reactive `{ start, end }` range (exclusive end), using civil `YYYY-MM-DD` dates in the planner zone or ISO instants:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { CalendarOverlay, useCalendarEvents } from '@/features/calendars'
const range = computed(() => ({ start: visibleFirstDate.value, end: exclusiveLastDate.value }))
const { events, busy, conflicts, conflictingBlockIds, errors, loading } = useCalendarEvents(range)
// Pass busy.value to scheduleTasks; it already subtracts document.events itself.
// Use conflictingBlockIds to mark dated plan blocks. events contains external occurrences only.
</script>
<template><CalendarOverlay :range="range" /></template>
```

`CalendarOverlay` supplies accessible occurrence rows and `data-testid="calendar-conflict"` marks for external busy events intersecting plan blocks. A time-axis implementation can render the hook's occurrences directly instead. Use `occurrenceKey` from `calendarOverlay.ts` for stable `(sourceId, uid, recurrenceId)` identity. Free/transparent events remain visible but do not block scheduling. The hook exposes errors per source; an expansion failure must never be presented as an empty, successfully checked calendar.

`EventSheet` is also exported for S1's create/edit action: `v-model:open` and optional `:event="plannerEvent"`. Settings already provides create/edit, provider links, single-event download and all-upcoming download.

S2/S4 can obtain the actual `CalendarSourceStore` through `calendarServices().texts` in `calendarStore.ts`. S4 installs its adapters with `configureCalendarServices({ texts: companionCalendarSourceStore, fetcher: companionIcsFetcher })` **before mounting features**. The default fetcher detects `window.__NEXT168__?.mode === 'companion'` and uses `/api/ics?url=` with same-origin cookies, without injecting tokens. The `IcsFetcher` interface in `icsFetcher.ts` is the injection boundary. Browser mode uses direct CORS fetch, omits credentials and referrers, and enforces a 10-second timeout and streamed 5 MiB byte limit.

## Storage and refresh

- Metadata lives in `document.calendarSources`. Raw ICS lives, keyed by source id, in IndexedDB database `next168-calendars`, object store `sources` (browser mode), or in the companion's `calendars/<sourceId>.ics` through `/api/calendars/:id` (companion mode), so every browser paired with the same companion shows the same calendars. When a source's text is not there, Settings › Calendars names the calendar and says what to do: import the file again, or refresh the subscription.
- URL refresh occurs once per workspace per open page session when a calendar view mounts, and via the explicit Refresh button. A failed refresh retains the last good feed and sync time, stores a translated error code, and allows offline expansion from the cached text.
- File import has no runtime network dependency. Later/future ranges are expanded from the original source rather than from a cached week.
- Source changes and removals are serialized within the calendar store. Raw writes precede the document commit and are rolled back on document-save failure. Removal commits metadata first so a failed save cannot discard the source. Failed raw cleanup can leave an unreferenced source for recovery. This does not claim an atomic transaction spanning IndexedDB and the planner repository or coordination of simultaneous raw refreshes in separate tabs.
- The shell's existing commit/lock protocol protects document revisions. Source/event removals offer undo. Write actions are disabled when the document is not writable, and an unsaved event sheet participates in the shell's update guard.

## Parser behavior and limits

`icsImport(text, sourceId, range, timeZone)` is framework-free and returns `ExternalOccurrence[]`. It uses unmodified `ical.js` **2.2.1**, MPL-2.0, published 2025-08-08. Verified from the installed package metadata and [upstream licence](https://github.com/kewisch/ical.js/blob/v2.2.1/LICENSE) on 2026-10-24. The [upstream event API](https://kewisch.github.io/ical.js/api/ICAL.Event.html) defines recurrence exception handling.

Resolution order is embedded VTIMEZONE, IANA through Intl, then an explicit Windows-to-IANA mapping for common Outlook zones. An unknown zone fails explicitly instead of silently becoming UTC. Floating times use the requested planner zone. All-day DATE values remain civil dates with exclusive ends and are converted to zoned midnight only for overlap/scheduler calculations. RRULE, EXDATE, RDATE DATE/DATE-TIME/PERIOD values, moved and detached RECURRENCE-ID exceptions, THISANDFUTURE shifts and cancelled instances are covered by unit tests.

Limits are per source/per requested range: 5 MiB UTF-8 input, 5,000 output occurrences, and 50,000 expansion work units. The work budget includes outer candidates and recurrence frequency reads and weighted calendar-step intervals, including hidden candidate-search loops inside `ical.js` and VTIMEZONE expansion. This conservatively rejects some feeds before 50,000 visible candidates; it prevents a single impossible rule from hanging the main thread. Rules with SECONDLY/MINUTELY frequency are rejected. Large intervals exceeding the work budget are rejected. A regression with `FREQ=HOURLY;BYMONTH=2;BYMONTHDAY=30` timed out before the budget was added and now terminates with `calendars.iterations`. No dependency files or global prototypes are patched.

Synthetic fixtures reproduce Google, Outlook and iCloud export shapes without personal data. They cover Bogotá RRULE/EXDATE, Windows zones, exclusive all-day ends, Madrid's 2026-10-25 DST transition, embedded-zone precedence and cancelled instances. The standalone export parse assertion uses **ical.js separately from Weeklid's importer**; Python `icalendar` was checked and is unavailable on this executor. A separate Python-parser verification remains available to the coordinator.

The extra development dependency `fake-indexeddb` **6.2.5** (Apache-2.0, published 2025-11-07) enables realistic IndexedDB transaction/persistence tests in Vitest, whose DOM environment has no native IndexedDB. It is not bundled into the app. No other new libraries were added.

## Provider/CORS evidence — 2026-10-24

**Browser evidence is pending.** This executor was explicitly instructed not to launch browsers in its workspace-write sandbox. The following are actual HTTP observations with `Origin: http://127.0.0.1:4173`, **not successful browser fetches** and not acceptance of the requested browser matrix:

| Public feed | UTC | HTTP outcome | Access-Control-Allow-Origin | Browser outcome |
| --- | --- | --- | --- | --- |
| [Google US holidays](https://calendar.google.com/calendar/ical/en.usa%23holiday%40group.v.calendar.google.com/public/basic.ics) | 2026-10-24 05:53:01 | 200; valid VCALENDAR, 120,685 bytes | absent | Not run; header suggests CORS denial |
| [UCT Outlook public holidays](https://outlook.office365.com/owa/calendar/f3b8cd563e9b4735b7f0479af9c85a48@uct.ac.za/2fdce791158d4b3c863d711af36d3a7611923565644488696156/calendar.ics) | 2026-10-24 05:53:01 | 200; valid VCALENDAR, 12,196 bytes | absent | Not run; header suggests CORS denial |
| Apple `calendars.icloud.com/holidays/us_en-us.ics/` candidate | 2026-10-24 05:53:02 | 200 HTML, not VCALENDAR; excluded as a feed | absent | Not run |

The Outlook URL is explicitly published for public subscriptions by [UCT's own IT service](https://icts.uct.ac.za/services-email-uct/uct-internet-calendars-ical). Only metadata was retained, not live calendar event contents. Public accessibility does not imply CORS permission. Private Google/Outlook/iCloud feed URLs often contain access tokens; the UI never sends them to a third-party proxy, console or analytics.

The coordinator must run the browser matrix outside the sandbox and replace the pending column with the dated observed result. The spec verifies each feed is currently a real ICS over HTTP and records the browser fetch separately, attaching `provider-cors-matrix.json`:

```sh
NEXT168_CALENDAR_PROVIDER_PROBE=1 npx playwright test e2e/calendars.spec.ts --grep @providers --project desktop
```

## Acceptance and handoff

`e2e/calendars.spec.ts` contains deterministic file import + Week conflict, a real local HTTP server without CORS, a changing CORS-enabled subscription with manual/on-open refresh and offline re-expansion, and create/edit/download/re-import of a meeting plus separate parsing and provider-link assertions. The event sheet asks for a title, a day, all day and from–to, with guests, location and notes under More; it does not show the time zone. Guests are a list of email addresses (Enter, a comma or Add adds one; each has its own 44 px remove button; what is not an email address is refused with a message). They are stored in the event's `attendees` and carried exactly as an imported or proposed event's attendees are: `ATTENDEE:mailto:` lines in the `.ics`, Google `add=` and Outlook `to=`. Weeklid sends nothing to them. Attendee emails are other people's personal data and never reach an assistant: the any-AI prompt and the on-device model do not include them, and the MCP `list_events` tool leaves them out. `eventDraft.spec.ts` covers the ICS and provider-link round trip; the e2e meeting test creates an event with two guests and parses the download. The live-provider probe is explicit and opt-in so third-party availability is not a deterministic CI dependency.

The Week assertion requires S1 integration; the S0-shell placeholder in this executor's base does not render the calendar overlay. Do not weaken it into a Settings-only assertion. No shared shell, S1 or model files were edited.

Run outside the sandbox after integrating S1:

```sh
npx playwright test e2e/calendars.spec.ts --grep-invert @providers
```

The executor leaves all source changes uncommitted, per its explicit Codex delivery instructions. The coordinator must refresh/integrate the latest base, commit, push and open the PR, and attach actual browser results. This slice is not verified complete until those observed outcomes pass.

## Local verification receipt

Verified 2026-10-24 at 06:03 UTC on uncommitted S3 work over `ea5adfbc3fa9388778f281f31198a2a28ec539a9`:

| Command | Observed result |
| --- | --- |
| `npm run type-check` | Exit 0 |
| `npx eslint .` | Exit 0, no findings |
| `npx vitest run` | Exit 0; 21 files, 190 tests passed (39 S3 tests) |
| `npm run build` | Exit 0; production bundle and PWA service worker generated |
| `npx playwright test e2e/calendars.spec.ts --list` | Exit 0; 15 cases listed across desktop/tablet/phone; no browser tests executed |
| `git diff --check` | Exit 0 |
| `git fetch origin` | Denied writing worktree `FETCH_HEAD` by the sandbox; no merge attempted |

The full test run emits Node's experimental localStorage warning; build emits two upstream Zod annotation warnings. Neither command fails. No browser/E2E or exact-head CI success is claimed.

Remote readback at 2026-10-24 06:01:16 UTC: integration `abcf42ca7840ff13df7750301a267d735eeb7ac2`; S0-shell `d9db484184959f154979b052bd332baeba234cf7` (advanced from this worktree's base). The coordinator must integrate current foundations before publication. No commits, pushes or PR were created. Worktree retained for its uncommitted handoff. Provider token/cost telemetry is unavailable in this executor, so usage and cost are UNKNOWN rather than zero.

## Google Calendar (Slice 1, labs)

Owner approval 2026-10-26: read the **primary** Google calendar from the browser, read-only, with no Weeklid server. Design, red team and spec live with the coordinator (Slice 1 spec, 2026-10-26); the code is `src/features/calendars/googleCalendar.ts` (what the rest of the app sees), `googleGate.ts` (the gate), `googleSavedEvents.ts` (the copy saved on the device) and `google/` (the chunk that talks to Google).

- **Gate.** The feature exists only when the build has `VITE_GOOGLE_CLIENT_ID` (validated by `vite.config.ts`; a malformed ID fails the build), the app is not in companion mode, the context is secure, and the device opted in by opening the app once with `?labs=google-calendar` (`localStorage` `next168-labs-google=1`, removed by Delete all data). A build without the ID contains no Google code: the UI is imported dynamically behind `import.meta.env.VITE_GOOGLE_CLIENT_ID`, and CI fails if `dist/assets` mentions `gsi/client`. The ID is set only in the Cloudflare Pages **Production** variables; GitHub Pages (`crexative.github.io`, not an authorised origin) never gets it.
- **Auth.** Google Identity Services, token model: `initTokenClient({ scope: calendar.events.readonly, include_granted_scopes: false, prompt: '' })`, no `login_hint`. The script `https://accounts.google.com/gsi/client` loads only when the Connect sheet opens; `requestAccessToken()` runs synchronously in the tap. A token without the events scope is revoked and nothing is read.
- **Token in memory, a copy of the events on the device.** The access token lives only in the tab's memory and is never written anywhere. Owner decision 2026-10-27 (Slice 1 showed "isn't loaded" after every reload, which he found unusable): the last **complete** read is also saved in its own IndexedDB database, `next168-google` (store `saved`), outside the planner document, so exports, backups, the pre-upgrade copy and the companion never include it. The record holds only the occurrences the overlay draws (`sourceId`, `uid`, `recurrenceId`, `title`, `start`, `end`, `allDay`, `busy`), the window and zone they cover, `fetchedAt`, and the planner they were read for (workspace id and generation); never the token, the scopes, an address or Google's raw answer. Titles are cut to 200 characters counted as code points (an emoji counts once), the same rule that checks the copy when it is read back. It is written only when a refresh is published (all or nothing), and validated field by field when read back (anything else is deleted). When the app opens, the connection store starts with it (Google's script still loads only when the Connect sheet opens) and shows the copy if it belongs to the current planner and zone; otherwise it deletes it. Week and Today then show a calm line, "Google Calendar · updated 3 hr. ago" with Update, which after 24 h adds "Your events might be out of date."; Settings shows "Updated 3 hr. ago · N events". "Google Calendar isn't loaded…" remains only when there is no copy. Update still needs a tap (Google opens its window only from a gesture); once a token is live in the tab, behaviour is as before. There is no timer and no refresh on focus. Nothing is written to `localStorage`, Cache Storage or the console.
- **Read.** `GET calendars/primary/events` with `singleEvents=true`, `orderBy=startTime`, `maxResults=250`, a window from today − 7 to today + 42 civil days padded by one day each side, and `fields=nextPageToken,items(id,status,summary,start,end,transparency,eventType,attendees(self,responseStatus),recurringEventId,originalStartTime)`; `cache: 'no-store'`, `credentials: 'omit'`, `referrerPolicy: 'no-referrer'`, 15 s per request, at most 8 pages. A refresh replaces the events only when every page arrived and every event was read (a time without an offset fails it); otherwise the previous events stay and the error is shown. The service worker leaves Google hosts to the network.
- **Lifecycle.** Every request carries the connection generation and the planner's workspace id and generation from the tap. Disconnect, Delete all data and an import or restore invalidate it: requests in flight are aborted, a late token is revoked unused, and other tabs forget too (`BroadcastChannel('next168-google')`). Disconnect reports "Google confirmed it withdrew access" only on Google's own confirmation; otherwise it links to `https://myaccount.google.com/connections`.
- **Deleting the saved copy.** Delete all data removes the copy in every build, including one without the client ID or with the feature off: the `next168-google` database is left holding only a new random, non-personal marker (and is not created on a device that never had it). Disconnect (locally, whatever Google answers to the revocation, also after a reload with no token), an import or restore, another workspace, a new planner time zone, and Google withdrawing the permission (a token request refused with `access_denied`, a token without the events scope, or a 401 for a token granted in that same tap) delete it; a 401 for an older token or any other error keeps it. Other tabs forget what they show, which closes open Google details and choosers. A deletion in one tab always beats a write that started before it in another: each deletion, Delete all data included, stores a new random epoch; a write lands only while the stored epoch is the one its tab last knew, and never in a database without one (the first read gives a new database its epoch); the Disconnect broadcast carries the new epoch (no other payload) so the other tab's next read is saved again.
- **AI.** The any-AI prompt and the on-device assistant get Google meetings as "Busy" without titles (`externalForAi`); the any-AI panel says so.
- **Diagnostics.** A collapsed "Details" in the section shows, from memory and the saved copy, whether the scope was granted, the token's remaining minutes, the last token/events/revoke result as a code with its UTC time, the number of events and the coverage dates. Never an address, id, title, token or Google's own text.

### Connection server (S1a, dormant)

The server in `server/google/` (operations: `DEPLOYMENT.md`, Functions) keeps one encrypted refresh token per device.

- **Device id.** `/connect` adopts the `__Host-wl_dev` id a browser presents only when a credential already exists for
  its hash; otherwise it mints a new id, so an id planted on a device without a connection never becomes the bearer of
  a credential. Each connect also sweeps expired pending rows in the same D1 batch.
- **Commit.** The callback inserts the credential from the device's pending row, deletes that row and sweeps, in one
  batch. On a reconnect the insert replaces the device's previous refresh token (`ON CONFLICT DO UPDATE`) **without
  revoking it**, by design: Google's revocation endpoint invalidates every access and refresh token the user granted
  to the project, so revoking the old token would also kill the one just issued
  ([Google, OAuth 2.0 for web server apps, Token revocation](https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke),
  read 2026-10-31). The replaced token is left to Google's own per client and user limit on refresh tokens, after
  which older ones stop working.

### Spike evidence (owner, production, real account)

Record dates in UTC and codes, counts and yes/no only: never addresses, ids, titles or screenshots of events.

| UTC date | Spike / check | Platform | Browser version | Observed |
| --- | --- | --- | --- | --- |
| | | | | |
