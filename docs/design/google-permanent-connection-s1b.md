# Permanent Google connection, slice S1b: the app client

Status: **proposed, revision 3** (red-team rounds 1 and 2 absorbed); risk tier critical (auth/credentials).
Implementation waits for the coordinator to accept this revision. Earlier revisions: `a3a5613` and `8e5fea2`
(2026-11-06). This revision is against `main` 8d6b6cb (S1a server merged at 9e2be62).

Goal: a person connects Google Calendar once per device and stays connected across reloads and app restarts, using
the deployed S1a server. Google Calendar stays read-only, primary calendar only. The approved design v7.1 is lost, so
this document rebuilds S1b from the server that shipped. Two fragments of v7.1 are kept: "client server mode" and
"it also deletes the canary route; critical". The third, "refresh on open and on return after 15 minutes", is cut to
*refresh on open* (OE-1).

## Red-team round 1 resolution (Codex, on `a3a5613`: ACCEPT WITH CHANGES)

| # | Finding | Resolution | Where |
|---|---|---|---|
| 1 | BLOCKER: a disconnect intent erased by eviction is reversed by auto-adoption | No silent adoption: only a `connected` record makes the app call the server on its own, and that record is written only after a Connect tap succeeds. With no record, the app shows Connect, and one tap first tries `/token`. Round 2 completes this with the fenced writes of 2-1 | §2.3 R-a, A-7 |
| 2 | MAJOR: `401 reconnect` is ambiguous | No server change, and the message is neutral. **Round 2 (2-4) changes the retention:** the copy goes on every `/token` 401, because of the rule "no working permission, no copy", not because Google is blamed | §2.3 R-e, §3 |
| 3 | MAJOR: "Disconnect everywhere" overstates what happens | The copy says only what is true: Weeklid loses access to that Google account, and other devices on that account must connect again. Owner assumption OD-S1b-2: the OAuth project serves only Weeklid | §0.3, §3 |
| 4 | MAJOR: iOS home-screen cookies are separate | Release gate G-1 before `VITE_GOOGLE_SERVER_INSTALLED=1`. Installed apps fall back to today's GIS mode; round 2 (2-3) makes detection fail safe | §2.1, A-18 |
| OE-1 | Drop the 15-minute reread | Dropped | §2.4 |
| OE-2 | Drop the persisted epoch and `epochAdopted` | Dropped, together with the `connecting` record. The server-required epoch is sent but not stored | §2.3 |

## Red-team round 2 resolution (Codex, on `8e5fea2`: ACCEPT WITH CHANGES)

| # | Finding | Resolution | Family checked | Where |
|---|---|---|---|---|
| 2-1 | BLOCKER: a stale tab can write `connected` again after Disconnect | **The existing epoch fence of `googleSavedEvents.ts` carries it; no new mechanism.** The `connected` record moves into that store's fenced writes: it lands only while the stored epoch equals the one this tab last knew, as `save()` already requires (`googleSavedEvents.ts:139-152`). Disconnect runs `discard()`, which in one transaction deletes the copy **and** the `connected` record and stores a new epoch, so any write that started before it is refused. A read is published, even in memory, only after the same epoch check, and a tab whose write was refused drops its token. A two-tab check holds a mint across a Disconnect | Every durable writer and deleter is listed in §2.3 "Fenced mutations", each with its fence | §2.3, A-11b |
| 2-2 | MAJOR: Delete all data with no IndexedDB leaves the server credential | In a server build, Delete all data **always** calls `status` → `disconnect{revoke:false}` first, with or without IndexedDB and with or without the labs flag. If that call does not get through, a tombstone is written to `localStorage` **after** the wipe. A boot processes the tombstone in every server build before anything else, labs or not. Tombstones move out of IndexedDB entirely, so their delivery never depends on a database that might be absent | Disconnect without a database, Disconnect from a GIS-mode tab in a server build (Android shares cookies between the app and Chrome), and a boot with the labs flag off are all covered | §2.3, §2.4, A-14, A-14b, A-14c |
| 2-3 | MAJOR: a wrong installed-app detection bypasses the fallback | Inverted: the server source is chosen only on **positive** evidence of a browser tab (`matchMedia('(display-mode: browser)')` matches, `navigator.standalone !== true`, and the referrer is not `android-app://`). Anything else, including a missing `matchMedia`, gets GIS. The signals are pinned per platform in §2.1. Details shows the selected source, so the owner checks it on each real context (A-18a) before any flag. Every flag combination is enumerated and asserted (§2.2) | Every context in §2.1, the unsupported `matchMedia` case, iPadOS, desktop installed apps, a TWA | §2.1, §2.2, A-15, A-18a |
| 2-4 | MAJOR: keeping the copy after an external revocation | Read on 2026-11-06. The User Data Policy has no rule on revocation (R-P1). The Workspace policy says "Honor user requests to delete their data" and forbids "creating permanent copies of Google User data" (R-P2). It does not name Calendar, though Calendar's docs sit under `developers.google.com/workspace/` (R-P3). Since the rule is unclear, the **conservative rule** applies: *the copy exists only while this device holds a working connection.* Every `/token` 401, a device with no `connected` record at boot, and a GIS-mode tab in a server build all mean no saved copy | GIS-era copies at the flag flip, other devices after an account-wide Disconnect, eviction (the copy and the record go together), GIS-mode installed apps | §2.3 R-e, §2.6, A-9, A-19 |
| 2-5 | MINOR: the Connect copy promises a trip to Google | Conditional copy: `goesToGoogle` | — | §3 |
| 2-6 | MINOR: flag combinations not discriminating | Full matrix with one executable assertion per row, plus the exact chunk assertion | — | §2.2, A-15 |
| 2-7 | MINOR: no test for a canary pending row left from before the removal | A handler test inserts a `return_to='canary'` pending row, runs the callback after the removal, and asserts the redirect to the app | — | §2.7, A-16 |

Rejected: none. Owner flag **OD-S1b-4** comes out of 2-4: the Workspace policy's "permanent copies … longer than
permitted by the cache header" (R-P2) also bears on the on-device copy itself, which the owner approved on
2026-10-27. That copy is per device, covers a bounded window, is replaced on every read, and now lives only while
connected. I read this as not a permanent copy, but the owner should confirm it before leaving Testing.

## 0. Findings the owner must see first

1. **While the consent screen stays in Testing, nobody stays connected for more than 7 days** (R-G1, R-G2). Under
   2-4, each expiry also deletes the copy. **Recommendation, owner decision OD-S1b-1:** after S1b is accepted,
   switch the publishing status to *In production*, still unverified (same warning, 100 new users in total, no 7-day
   expiry, no allowlist).
2. **Conflict over who removes the canary.** The docs say S1c (`DEPLOYMENT.md:177`); the task says S1b. This design
   follows the task (§2.7).
3. **Disconnect is account-wide** (R-11, R-G3), assuming the OAuth project serves only Weeklid (OD-S1b-2).
4. **The privacy draft becomes false once the flag is on** (`docs/privacy-google-calendar.md:25`); S1b rewrites it.
5. OD-S1b-3 (where to run G-1) and OD-S1b-4 (above).

## 1. Research (read 2026-11-06)

Repository facts were checked at `8d6b6cb`. External sources are primary docs. Only documentation pages were
fetched; no Google or Cloudflare production endpoint was called.

| # | Constraint relied on | Source |
|---|---|---|
| R-1 | `POST /connect` body exactly `{from, epoch}` → `200 {url}`; sets `__Host-wl_dev` (Strict) and `__Host-wl_gflow` (Lax, 600 s) | `server/google/handlers.ts:58-107`, `:22-27`, `server/google/http.ts:102-104` |
| R-2 | `/connect` adopts a presented device id only when it already has a credential | `handlers.ts:69-77` |
| R-3 | `GET /callback` always answers `303` to `${APP_ORIGIN}/?google=<result>#/settings/calendars`, with a closed set of results | `handlers.ts:112-127`, `:120` |
| R-4 | Without the secret, the callback answers `canary`/`cancelled` | `handlers.ts:158-159` |
| R-5 | `/token`: `200 {accessToken, expiresIn, epoch, pending}`; `401 noDevice\|notConnected`; `401 reconnect` for a key mismatch, a decryption failure, a missing scope or `invalid_grant`; `5xx` | `handlers.ts:202-265` |
| R-6 | `/status` → `{gen, connected, pending}`; with no cookie, `gen:'-.-'` | `handlers.ts:269-285` |
| R-7 | `/disconnect{revoke, gen}`: generation-fenced; `confirmed\|unconfirmed\|forgotten\|none\|stale`; revokes only this device's token; with no cookie, `none` | `handlers.ts:289-324` |
| R-8 | POST guards: `X-Weeklid: 1`, `Origin`, `Sec-Fetch-Site` absent or same-origin | `http.ts:116-125` |
| R-9 | Credentials are keyed by device hash, not by account; a reconnect replaces without revoking | `connectionStore.ts:100-112` |
| R-10 | 190-day idle sweep | `handlers.ts:27`, `:247` |
| R-11 | Spike: refresh works, access token about 1 h, revocation is grant-wide | `docs/calendars.md:131-146` |
| R-12 | Lock contract D15 (`'weeklid-google'`, exclusive, 20 s/15 s, no fallback) | `functions/api/google/canary/script.ts:1-38` |
| R-13 | Owner canary PASS in browser tabs; installed apps untested | `DEPLOYMENT.md:201-205` |
| R-14 | Today's client: GIS, token in memory, saved copy, cross-tab forget | `useGoogleConnection.ts:13-16`, `:122`, `:187-191`, `:213-220` |
| R-15 | **The epoch fence:** `save()` writes only while the stored epoch equals the tab's known one; `discard()` and `erase()` store a new epoch; a database with no marker refuses writes | `googleSavedEvents.ts:9-12`, `:139-152`, `:154-164`, `:166-178`, `:116-137` |
| R-16 | `erase()` does nothing where the database is absent; Delete all data calls it | `googleSavedEvents.ts:166-170`, `DataSettings.vue:140` |
| R-17 | The service worker leaves `/api/` and Google hosts to the network | `vite.config.ts:17`, `:19`, `:70-71` |
| R-18 | Manifest `display: 'standalone'`, scope `./` | `vite.config.ts:49-55` |
| R-19 | CSP allows GIS and `connect-src 'self' https:` | `index.html:4` |
| R-20 | CI checks a build without a client ID for `api/google` and `gsi/client` | `.github/workflows/ci.yml:34-45` |
| R-21 | e2e fakes Google and runs over `vite preview` on `http://127.0.0.1` | `e2e/support/googleCalendar.ts:3-6`, `playwright.config.ts:39` |
| R-G1 | Testing → 7-day refresh tokens; tokens also die when revoked, after 6 months unused, or past 100 per account | https://developers.google.com/identity/protocols/oauth2 (read 2026-11-06) |
| R-G2 | Testing: 100 test users, authorizations expire 7 days after consent; production unverified: a warning and 100 new users in total | https://support.google.com/cloud/answer/15549945 (read 2026-11-06) |
| R-G3 | `invalid_grant` = expired or invalidated; revocation removes the whole authorization | https://developers.google.com/identity/protocols/oauth2/web-server (read 2026-11-06) |
| R-W1 | Safari deletes all script-writable storage (IndexedDB and localStorage) after 7 days of use without interaction; home-screen apps keep their own counter | https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (read 2026-11-06) |
| R-A1 | iOS home-screen apps: "separate cookies and storage from the browser"; out-of-scope links open in Safari View Controller; OAuth staying in the app is a "heuristic" | https://developer.apple.com/videos/play/wwdc2023/10120/ (read 2026-11-06) |
| R-C1 | Pages: with no matching Function, a request falls back to static assets | https://developers.cloudflare.com/pages/functions/routing/ (read 2026-11-06) |
| R-P1 | Google API Services User Data Policy: "You must disclose all user data that you access, use, store, delete, or share"; Limited Use: "Limit your use of data to providing or improving user-facing features". **No rule on revocation or retention** | https://developers.google.com/terms/api-services-user-data-policy (read 2026-11-06) |
| R-P2 | Google Workspace API User Data and Developer Policy: "Honor user requests to delete their data"; "You must provide user help documentation that explains how users can manage and delete their data"; it forbids "creating permanent copies of Google User data … This includes keeping cached copies longer than permitted by the cache header"; tokens must be encrypted at rest. **No rule on revocation**, and Calendar is not named | https://developers.google.com/workspace/workspace-api-user-data-developer-policy (read 2026-11-06) |
| R-P3 | The Calendar API overview sits under `developers.google.com/workspace/` but does not say which policy applies | https://developers.google.com/workspace/calendar/api/guides/overview (read 2026-11-06) |

Unknowns:
- U-1: the installed-app round trip (G-1, A-18).
- U-2: whether a new consent restarts the 7-day clock for other devices (A-19).
- U-3: how real installed contexts answer the detection signals (A-18a).

## 2. Minimal design

### 2.1 Shape and source selection

There is one change of dependency: where the access token comes from. Everything after that stays as it is: events
read straight from the browser to `googleapis.com`, normalization, the copy, the epoch fence, the BroadcastChannel
forget, the tickets, and AI as "Busy".
- `gis`: today's behaviour.
- `server`: `serverConnection.ts` over the S1a routes.

The refresh token never reaches the browser; the access token stays in tab memory only.

**Selection, once per page load, fail-safe to `gis`:**

```
browserTab = matchMedia exists
             && matchMedia('(display-mode: browser)').matches
             && navigator.standalone !== true
             && !document.referrer.startsWith('android-app://')
source     = !SERVER ? 'gis'
           : browserTab ? 'server'
           : INSTALLED && installedApp ? 'server'          // installedApp = display-mode standalone|fullscreen|minimal-ui
           : 'gis'                                         // uncertain contexts included
```

| Context | Expected signals | Source before G-1 | Source after G-1 (`INSTALLED=1`) |
|---|---|---|---|
| Desktop Chrome/Edge/Firefox/Safari tab | display-mode `browser` | server | server |
| iPhone/iPad Safari tab | `browser`, `navigator.standalone === false` | server | server |
| iPhone/iPad home-screen app | `standalone`, `navigator.standalone === true` | gis | server |
| Android Chrome tab | `browser` | server | server |
| Android installed app (WebAPK) | `standalone` | gis | server |
| Android TWA (not shipped) | referrer `android-app://` | gis | server |
| Desktop installed app | `standalone`/`minimal-ui` | gis | server |
| No `matchMedia`, or an unknown mode | — | gis | gis |

`installedNote` (§3) is shown whenever an installed or uncertain context lands on `gis` in a server build.

### 2.2 Files and flag matrix

| File | Change |
|---|---|
| `src/features/calendars/google/serverConnection.ts` (new) | Transport: `X-Weeklid: 1`, same-origin credentials, `no-store`, a 15 s abort, the R-12 lock (copied from the canary), closed reply mapping (§2.5); `forgetThisDevice(revoke)` = `status` → `disconnect{revoke, gen}` (one `stale` retry) |
| `useGoogleConnection.ts` | A `TokenSource` port; §2.3–§2.4; in a server build every Disconnect runs `forgetThisDevice(true)`, whatever the source |
| `googleSavedEvents.ts` | Key `server` = `{state:'connected'}`, written only through `saveConnected()`, fenced like `save()`; `discard()` and `erase()` delete it in the same transaction as the copy; a new `fencedCheck()` (epoch still known) |
| `src/features/calendars/googleTombstone.ts` (new, server builds only) | The `localStorage` key `next168-google-forget` = `'revoke'\|'forget'`: read, write and clear |
| `googleGate.ts` | `googleTokenSource()` (§2.1) and `captureGoogleReturn()` (strips `?google=`) |
| `src/features/calendars/index.ts` | In a server build: strip `?google=`; if a tombstone exists, run `forgetThisDevice` **before** the labs check and before the store starts |
| `DataSettings.vue` | In a server build, Delete all data: `forgetThisDevice(false)` (5 s budget) → the existing wipe → the tombstone `'forget'` if the call did not reach a terminal result |
| Sheet and section `.vue` | Connect and Disconnect per §2.3; Details shows `source` and the last `server` code; `installedNote` |
| `env.d.ts`, `vite.config.ts` | The flag matrix below |
| `.github/workflows/ci.yml` | The chunk assertions below |
| i18n (5 locales), `docs/calendars.md`, `DEPLOYMENT.md`, privacy draft | §3; gate G-1; merged D1+D3; privacy §4/§8 (encrypted per-device permission on D1, events never through it, the copy only while connected, Disconnect account-wide) |
| Canary removal, e2e, contract spec | §2.7, §4 |

**Flag matrix**: values are unset, `''` (= unset) or `1`; any other value fails. Each row is a case in
`config/viteConfig.spec.ts`:

| `VITE_GOOGLE_CLIENT_ID` | `VITE_GOOGLE_SERVER` | `VITE_GOOGLE_SERVER_INSTALLED` | Build | Bundle assertion (CI) |
|---|---|---|---|---|
| unset | unset | unset | ok | no `gsi/client`, no `api/google` in `dist/assets` (exists) |
| unset | 1 | any | **fails** | — |
| unset | unset | 1 | **fails** | — |
| set | unset | unset | ok | no `api/google` in `dist/assets` (the e2e build) |
| set | unset | 1 | **fails** | — |
| set | 1 | unset | ok | `api/google` and `gsi/client` absent from the entry `index-*.js`, each present in some other chunk |
| set | 1 | 1 | ok | same as the row above |
| any | `true`, `0`, `yes`, … | any | **fails** | — |
| any | any | `true`, `0`, `yes`, … | **fails** | — |

The runtime matrix (§2.1 table × the three valid flag rows) is a table-driven unit test of `googleTokenSource()`.

### 2.3 Connection state (server source)

**Durable state.**
- IndexedDB `next168-google`, key `server`: absent or `{state:'connected'}`, inside the epoch fence (R-15).
- `localStorage` `next168-google-forget`: absent, `'revoke'` or `'forget'`.

Boot behaviour:
1. A tombstone present → `forgetThisDevice(tombstone === 'revoke')`. A terminal result clears it. **No `/token` call
   while a tombstone exists.**
2. Else, record `connected` → `/token`, then a read.
3. Else (no record) → no server call; **delete any copy** (R-e); show Connect.

```
 disconnected ─tap Connect─▶ POST /token (lock)
   │   200 → saveConnected() [fenced] ─ saved → connected ; refused → drop token, connectFailed
   │   401 any → POST /connect{from:'app', fresh epoch} → release lock → location.assign
   │            … Google … ?google=connected → saveConnected() [fenced] → mint → connected
   │            ?google=<other> → disconnected + message
   │   network/5xx/lock → disconnected + message, nothing written
 connected ─boot/Update─▶ /token: 200 → token in RAM → read → fencedCheck() → publish + save()
                         401 any → discard() (copy + record, new epoch) → needsReconnect
                         network/5xx/disabled → connectedOffline (copy kept: the record still exists)
 any ─tap Disconnect─▶ (1) write tombstone 'revoke' (sync)
                       (2) discard(): copy + record deleted, new epoch, broadcast ─ fails and its
                           deleteDatabase fallback fails → disconnectStuck, no "Disconnected"
                       (3) forgetThisDevice(true): terminal → clear tombstone → message ; else → disconnectPending
```

**Fenced mutations** (the 2-1 and 2-2 family; every writer and deleter of durable state):

| Mutation | By | Fence | Stale writer / missing database |
|---|---|---|---|
| put copy | `save()` after a read | stored epoch == known (exists) | refused after any discard or erase in any tab |
| put `connected` | `saveConnected()` after `/token 200` or `?google=connected` | **the same epoch check** | refused after Disconnect in any tab, so the stale tab drops its token and shows Connect. A missing database has no marker, so the write is refused (R-15) and the tab shows `connectFailed`: fail safe |
| publish a read (memory) | `refresh()` | ticket **and** `fencedCheck()` just before publishing; the broadcast forget also aborts in-flight requests | a tab that missed the broadcast still fails the epoch check, so nothing is shown and its token is dropped |
| delete copy + `connected` | `discard()` (Disconnect, any 401, no record at boot), `erase()` (Delete all data) | unconditional, new epoch | fallback `deleteDatabase()` (exists); if that fails too → `disconnectStuck` |
| write tombstone | Disconnect (before discard), Delete all data (after the wipe, only if the server call failed) | unconditional; localStorage, needs no database | a write failure loses only the retry: the record is already gone (fail safe), and the message stays `disconnectPending` with the permissions link |
| clear tombstone | after a terminal `forgetThisDevice` | only if the value is still the one this run read | a newer tombstone is never cleared by an older run |
| server credential | `forgetThisDevice` | generation-fenced on the server (R-7) | runs in every server build, whatever the source, the labs flag or the database |

Rules:
- **R-a: no silent connection.** `/token` runs on its own only with a `connected` record and no tombstone. A
  `connected` record comes only from a tap, and its write is fenced.
- **R-b: fail closed.** Disconnect never says "Disconnected" unless the record is gone.
- **R-c: one lock.** Every server call runs under `'weeklid-google'`. Without `navigator.locks`, nothing is sent
  (`lockUnavailable`).
- **R-d: tickets** as today (`useGoogleConnection.ts:72-74`), plus `fencedCheck()`.
- **R-e: retention, conservative (2-4).** A saved copy exists only while this device holds a `connected` record that
  has not been answered by a 401. Every `/token` 401, a boot without a record, Disconnect, Delete all data and the
  existing rules (import, restore, workspace or zone change) delete it. A transient failure (network, 5xx, `disabled`)
  keeps it, because the connection is still believed valid. In a server build, a tab on the `gis` source keeps events
  **in memory only** and saves no copy.
- **R-f: the access token** is reused until `expiresIn − 60 s`; a Calendar 401 with an older token → one re-mint.
- The `/connect` epoch is fresh and not stored; the mint reply's `epoch` and `pending` are ignored.

### 2.4 When the server is called (no timers)

| Trigger | Call |
|---|---|
| App open, any server build (labs or not) | the tombstone, if any (§2.3) |
| App open, server source, labs on | the `connected` record → `/token` and a read; otherwise none |
| Update | re-mint if the token has lapsed, then read |
| Connect, Disconnect | §2.3; Disconnect also from a `gis`-source tab in a server build |
| Delete all data, server build | `forgetThisDevice(false)` |
| `?google=` on boot | `connected` → `saveConnected()` and mint; otherwise a message |

### 2.5 Mapping server answers

| Answer | State | Saved copy | Message key |
|---|---|---|---|
| `/token 200` | connected | replaced by the read | — |
| `/token 401` (any) on boot or Update | needsReconnect | **deleted** (R-e) | `reconnectNeeded` |
| `/token 401` on a Connect tap | → `/connect` → Google | (none) | — |
| `503 disabled`; callback `disabled\|notConfigured\|canary` | connectedOffline / disconnected | kept / none | `serverPaused` |
| other `5xx`, `403`, `400` | connectedOffline | kept | `serverUnavailable` |
| network / abort | connectedOffline | kept | none on boot; `network` on a tap |
| lock busy / unavailable | unchanged | kept | `busy` / `lockUnavailable` |
| callback `denied`, `cancelled` | disconnected | none | `accessDenied` |
| callback `missingScope` | disconnected | none | `missingScope` |
| callback `state\|auth\|exchange\|noRefreshToken\|storage\|error\|unknown` | disconnected | none | `connectFailed{code}` |
| `saveConnected` refused | disconnected | none | `connectFailed{code:'stale'}` |
| disconnect `confirmed` | disconnected | deleted | `revokeConfirmed` |
| disconnect `unconfirmed` / `none` | disconnected | deleted | `revokeUnconfirmed` + permissions link |
| disconnect not terminal | disconnectPending | deleted | `disconnectPending` + permissions link |
| record not deletable | disconnectStuck | deleted where possible | `disconnectStuck` + permissions link |

### 2.6 Migrating from today's GIS client

- At the first server-source boot, a GIS-era copy has no `connected` record, so it is **deleted** (R-e), and the
  section shows Connect. One connect brings the events back. This replaces revision 2's "keep the copy".
- An old-chunk tab keeps GIS mode until it reloads. Disconnect revokes both grants (same client).
- **Rollback:** unset `VITE_GOOGLE_SERVER` and redeploy. The GIS build ignores the `server` key and the tombstone.
  Credentials sit unused until the 190-day sweep or the `DEPLOYMENT.md` purge. The hard stop is still removing
  `GOOGLE_SERVER_ENABLED`.

### 2.7 Removing the canary

Delete:
- `functions/api/google/canary/{index,script}.ts`;
- `server/google/canary.spec.ts`;
- the canary rows of `guards.spec.ts` and `routes.spec.ts`.

Then narrow `from` to `'app'` (`handlers.ts:66`) and drop the canary target (`handlers.ts:142`). Kept without change:
the D1 `CHECK` (`connectionStore.ts:96`, needs a migration) and the missing-secret `canary` outcome (`handlers.ts:159`
→ `serverPaused`).

**New handler test (2-7):** write a `google_pending` row with `return_to='canary'` directly (the harness's sqlite),
run the post-removal callback with its state, and assert `303` to `${APP}/?google=<result>#/settings/calendars`.
Also assert that `from:'canary'` answers `400`. These removals are the only server edits.

### 2.8 Rollout (owner)

1. Merge S1b.
2. Set `GOOGLE_CLIENT_SECRET` and `VITE_GOOGLE_SERVER=1`, redeploy, and run A-17.
3. Run A-18a on every context of §2.1 (Details → source).
4. Gate G-1 (A-18). If it passes on both installed platforms, set `VITE_GOOGLE_SERVER_INSTALLED=1` and redeploy.
5. A-19 over the next 8 days.

The labs gate stays throughout.

## 3. User-facing copy (en, es; pt/de/fr follow, parity enforced by `messages.spec.ts`)

Unchanged: `connect`, `continue`, `readOnly`, `aiBusy`, `accessDenied`, `missingScope`, `disconnect`, `disconnectTitle`
("Disconnect Google Calendar?"), `revokeConfirmed`.

| Key | en | es |
|---|---|---|
| `stayConnected` | You connect once on this device and stay connected, also after closing Weeklid. For that, a Weeklid server keeps Google's permission for this device, encrypted. Your events never go through it: they come straight from Google to this device. | Conectas una vez en este dispositivo y sigues conectado, también después de cerrar Weeklid. Para eso, un servidor de Weeklid guarda cifrado el permiso de Google para este dispositivo. Tus eventos nunca pasan por él: llegan directo de Google a este dispositivo. |
| `deviceCopyServer` | While this device is connected, a copy of your events is saved only on it so you see them when you open Weeklid. It is deleted when this device stops being connected. | Mientras este dispositivo está conectado, una copia de tus eventos se guarda solo en él para verlos al abrir Weeklid. Se borra cuando este dispositivo deja de estar conectado. |
| `goesToGoogle` (2-5) | If Weeklid still has permission on this device, you're connected right away. Otherwise you'll go to Google and come back here. | Si Weeklid todavía tiene permiso en este dispositivo, te conectas al instante. Si no, irás a Google y volverás aquí. |
| `testingServer` (removed by OD-S1b-1) | While the app is in testing, Google shows an unverified-app warning and asks you to connect again every 7 days. | Mientras la app está en prueba, Google muestra un aviso de app no verificada y te pide conectar de nuevo cada 7 días. |
| `disconnectBodyServer` | Weeklid will lose access to this Google account. If you connected Weeklid with the same account on other devices, they will need to connect again, and each deletes its copy of your events the next time it opens Weeklid online. The copy on this device is deleted now. | Weeklid perderá el acceso a esta cuenta de Google. Si conectaste Weeklid con la misma cuenta en otros dispositivos, tendrán que conectarse de nuevo, y cada uno borrará su copia de tus eventos la próxima vez que abra Weeklid con conexión. La copia de este dispositivo se borra ahora. |
| `messages.revokeUnconfirmed` (server) | Disconnected on this device. We couldn't confirm with Google that Weeklid lost access to your account: check your account permissions. | Desconectado en este dispositivo. No pudimos confirmar con Google que Weeklid perdió el acceso a tu cuenta: revisa los permisos de tu cuenta. |
| `messages.disconnectPending` | Disconnected on this device. Weeklid will finish removing its access to your Google account next time you open it online, or you can remove it now in your account permissions. | Desconectado en este dispositivo. Weeklid terminará de quitar su acceso a tu cuenta de Google la próxima vez que lo abras con conexión, o puedes quitarlo ya en los permisos de tu cuenta. |
| `messages.disconnectStuck` | Couldn't disconnect on this device because its storage isn't responding. Try again, or remove Weeklid in your account permissions. | No se pudo desconectar en este dispositivo porque su almacenamiento no responde. Inténtalo de nuevo o quita Weeklid en los permisos de tu cuenta. |
| `messages.reconnectNeeded` | This device is no longer connected to Google Calendar, so its copy of your events was deleted. Connect again to see them. | Este dispositivo ya no está conectado a Google Calendar, así que se borró su copia de tus eventos. Vuelve a conectar para verlos. |
| `messages.serverPaused` | The Google Calendar connection is paused for now. Your saved events stay. | La conexión con Google Calendar está en pausa por ahora. Tus eventos guardados se quedan. |
| `messages.serverUnavailable` | Couldn't reach Weeklid's Google connection. Your saved events stay; try again later. | No pudimos llegar a la conexión de Google de Weeklid. Tus eventos guardados se quedan; inténtalo más tarde. |
| `messages.connectFailed` | Google didn't complete the connection ({code}). Try again. | Google no completó la conexión ({code}). Inténtalo de nuevo. |
| `messages.lockUnavailable` | This browser can't connect Google Calendar safely. Update it and try again. | Este navegador no puede conectar Google Calendar de forma segura. Actualízalo e inténtalo de nuevo. |
| `installedNote` | Here Google asks for permission again about every hour, and your events aren't saved between visits. To stay connected, open Weeklid in your browser. | Aquí Google vuelve a pedir permiso más o menos cada hora y tus eventos no se guardan entre visitas. Para seguir conectado, abre Weeklid en tu navegador. |

`googleCopy.spec.ts` gains server-mode cases. They assert "Tus eventos nunca pasan por él", "misma cuenta" and
"Si Weeklid todavía tiene permiso". They also assert that no server-mode string says "todos tus dispositivos",
"every device" or a locale equivalent.

## 4. Acceptance checks

The e2e harness extends the existing one:
- `e2e/support/googleServer.ts` fakes `/api/google/*` through `context.route`; its reply shapes are pinned by A-2.
- A third Playwright `webServer` builds with `VITE_GOOGLE_SERVER=1`.
- The callback is simulated by navigating to `/?google=<result>#/settings/calendars`.
- Calendar reads use the existing fake Google.
- Cookie and guard semantics are proven by the server suite and the canary.

| # | Check | How it is observed |
|---|---|---|
| A-1 | Every row of §2.5 → that state, copy action and message | unit, table-driven |
| A-2 | The client parser accepts the real replies of every route and outcome | unit (node): `server/google/clientContract.spec.ts` over the S1a harness |
| A-3 | Headers, credentials, `no-store` and the lock on every call; nothing is sent without `navigator.locks` | unit, plus the e2e request log |
| A-4 | Connect without a credential: `/token` 401 → `/connect{from:'app', epoch}` → navigation; `gisLoads === 0`; no epoch stored | e2e |
| A-5 | `?google=connected` → `connected` record → mint → events; the parameter is stripped | e2e |
| A-6 | Reload: exactly one `/token` and one read, no consent | e2e |
| A-7 | No record but a server that would answer 200 → zero `/api/google` calls at boot, and any copy deleted; one Connect tap → connected with no navigation | e2e |
| A-8 | No token persisted anywhere (pattern of `google-calendar.spec.ts:224-252`; the tombstone is the only new non-Google-DB key) | e2e |
| A-9 | `/token 401` (reconnect, then notConnected) on boot → copy **deleted** here and in a second tab, `reconnectNeeded`, record gone, no further `/token` at the next boot | e2e (two pages) |
| A-10 | Offline or `502` on boot → copy kept, no banner; retried at the next boot or Update | e2e |
| A-11 | Disconnect online: tombstone and `discard()` before the first request; then `status` and `disconnect{revoke:true}`; the dialog text matches §3 | e2e |
| A-11b | **Two tabs (2-1):** tab B holds a `/token` reply (route held); tab A disconnects; B's reply is released with `200`. Assert: the IndexedDB `server` key is absent, B makes **no** Calendar read and shows no Google event, B's next boot makes no `/token` call; B with BroadcastChannel stubbed out gives the same result | e2e |
| A-12 | Disconnect offline → `disconnectPending`; reload online → `disconnect` first and no `/token`; with the tombstone removed by hand → zero calls, Connect | e2e |
| A-13 | `discard()` and `deleteDatabase()` both reject → `disconnectStuck`, no "Disconnected"; `stale` → one retry | unit |
| A-14 | Delete all data online → `status` + `disconnect{revoke:false}` before the wipe; no tombstone afterwards | e2e |
| A-14b | **Delete all data with no `next168-google` database (2-2), labs flag off:** the server calls are still made; offline, the tombstone is written after the wipe, and the next boot (labs still off) sends `disconnect{revoke:false}` and nothing else | e2e |
| A-14c | Disconnect from a `gis`-source context in a server build calls `disconnect{revoke:true}` | e2e (emulated standalone) |
| A-15 | The flag matrix (§2.2): every row a `viteConfig.spec.ts` case; CI runs the three bundle assertions; reverting any `vite.config.ts` check fails a case | unit, CI |
| A-15b | `googleTokenSource()` over §2.1 × valid flag rows, including no `matchMedia` → `gis`, and `standalone` with `INSTALLED` unset → `gis` | unit |
| A-16 | Canary gone; a pre-existing `return_to='canary'` pending row → `303` to the app (2-7); `from:'canary'` → 400; in production, `GET /api/google/canary` returns the app | unit; production with the owner |
| A-17 | Production browser tabs (desktop Chrome, iPhone Safari, Android Chrome): connect, reload, reopen the next day, still connected | production with the owner |
| A-18a | **Detection on real contexts:** Details → source reads `server` in each browser tab of §2.1 and `gis` in the iPhone and Android home-screen apps and in a desktop installed app, with `INSTALLED` unset | production with the owner, recorded |
| A-18 | **Gate G-1:** with `INSTALLED=1` (OD-S1b-3: production with an immediate revert, or a preview with variables), connect inside each home-screen app; the return lands in the app with it connected; force-close and reopen, still connected. If either fails, `INSTALLED` stays unset and the result is recorded | production with the owner |
| A-19 | Two devices on the same account: Disconnect on A → B's next online open gives `reconnectNeeded` and **deletes** B's copy. In Testing, `reconnectNeeded` at about day 7–8 (and U-2 is answered) | production with the owner, dated |
| A-20 | The privacy draft: no "no Weeklid server"; the copy exists only while connected; Disconnect is account-wide; how to delete (R-P2) | PR diff review |

## 5. Rejected alternatives and over-engineering removed

- **The browser keeps the refresh token**, or **the server proxies events**. Rejected (a secret in the browser, or
  events passing through Weeklid).
- **A GIS code-client popup.** Rejected: it needs server changes and popups are fragile in installed apps.
- **Silent adoption** (revision 1). Rejected (round 1).
- **A new cross-tab fence** (`BroadcastChannel` acknowledgements, a Web Lock held for the whole session). Rejected: the
  existing epoch fence already orders deletions before writes in every tab (2-1).
- **A server-side tombstone or a new `/forget` route.** Rejected: `status` + `disconnect` already do it, and the
  client tombstone covers the offline case.
- **Keeping the copy after any 401** (revision 2). Rejected under the conservative policy reading (2-4).
- **Distinct server outcomes for `reconnect`.** Rejected: the client treats every 401 the same.
- **Detecting installed apps in order to exclude them** (revision 2). Rejected for positive browser-tab detection
  (2-3). So is enabling installed apps per platform by sniffing.
- **Deferred:** "disconnect this device only".
- **Removed as YAGNI:**
  - the 15-minute reread;
  - the persisted epoch and the `connecting` record;
  - timers, Background Sync and push;
  - token sharing between tabs;
  - `pending` handling;
  - a "connected" broadcast;
  - retry loops beyond one `stale` retry;
  - a D1 migration.

## 6. What the red team should attack (round 3)

1. **The epoch fence as an authority.** It was built for the copy. Check every path that changes `EPOCH_KEY`
   (`loadMatching` on a mismatched copy, a planner or zone change in another tab) to see whether it can refuse a
   legitimate `saveConnected()` in a loop, or let one through after a Disconnect.
2. **The order of tombstone, then discard.** A crash between them leaves a tombstone with the record still present.
   Boot processes the tombstone first, then must not mint: verify that the record is cleared on the terminal result.
3. **The tombstone in `localStorage`.** It is cleared by Delete all data's prefix wipe, which is why it is written
   after the wipe. Can a Delete all data in another tab erase a fresh Disconnect tombstone?
4. **Positive browser detection:** in-app browsers (Instagram, Gmail), iPadOS desktop mode, Firefox Android, and a
   `display-mode` override.
5. **Retention reading (OD-S1b-4).** Is "only while connected" enough for the Workspace policy's cache-header clause?
6. **Delete all data's server call** while another tab is mid-Connect (the server's generation fence against our
   single `stale` retry).
