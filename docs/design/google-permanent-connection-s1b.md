# Permanent Google connection, slice S1b: the app client

Status: **proposed, revision 2** (red-team round 1 absorbed); risk tier critical (auth/credentials). Implementation
waits for the coordinator to accept this revision. Revision 1 was `a3a5613` (2026-11-06); this revision is against
`main` 8d6b6cb (S1a server merged at 9e2be62).

Goal: a person connects Google Calendar once per device and stays connected across reloads and app restarts, using
the already-deployed S1a server. Google Calendar stays read-only, primary calendar only. The approved design v7.1 is
lost, so this document rebuilds S1b from the server that shipped. Two fragments of v7.1 are kept: "S1b: client server
mode" and "S1b (the client; it also deletes the canary route; critical)". The third, "refresh on open and on return
after 15 minutes", is cut to *refresh on open* (red-team round 1, OE-1).

## Red-team round 1 resolution

Review: Codex, verdict **ACCEPT WITH CHANGES** on `a3a5613` (`/tmp/weeklid-s1b-redteam/redteam.md`). No finding is
rejected.

| # | Finding | Resolution | Where |
|---|---|---|---|
| 1 | BLOCKER: a disconnect intent erased by storage eviction is reversed by auto-adoption | **No silent adoption.** Only a `connected` record makes the app call the server on its own. When there is no record, the app shows Connect. A Connect tap first tries `POST /token`; if the server still holds the credential, that one tap reconnects without going to Google. Disconnect's first, closing step is to **delete** the `connected` record (a delete also works when storage is full). If that delete fails, the app fails closed: it does not say "disconnected", it shows `disconnectStuck` and keeps the Disconnect action. The `forget` record that remains is only a retry aid; losing it cannot reconnect anyone | §2.3 R-a, §2.4, §2.5, A-11–A-14 |
| 2 | MAJOR: `401 reconnect` also covers a key mismatch, a decryption failure and a missing scope | **Client-only.** No `/token` answer deletes the saved copy; `reconnect` keeps it (with its stale line) and gets neutral copy that does not blame Google. Splitting the outcome on the server would not help: even a pure `invalid_grant` mixes revocation with the 7-day Testing expiry, 6 months unused and the 100-token limit (R-G1), so no closed outcome proves the person withdrew access. **No server change** | §2.3 R-e, §2.5, §3 `reconnectNeeded`, A-9 |
| 3 | MAJOR: "Disconnect everywhere" overstates what happens | The copy now says only what is true. Disconnect removes Weeklid's access to **that Google account**, and other devices connected with the same account must connect again. Other devices' copies are not promised to be deleted. The button is plain "Disconnect". Assumption for the owner, **OD-S1b-2**: the OAuth client's project serves only Weeklid | §0.3, §3, A-19 |
| 4 | MAJOR: iOS home-screen apps keep cookies separate from Safari | A same-context OAuth round trip from the installed app on iPhone and on Android becomes **release gate G-1**, checked before `VITE_GOOGLE_SERVER_INSTALLED=1` is set. Until that gate passes, an installed app (display-mode `standalone`) runs today's GIS mode, with honest copy; browser tabs use the server mode. If the gate passes on only one platform, both installed apps stay on GIS mode (no platform sniffing) | §2.1, §2.2, §2.8, §3 `installedNote`, A-18 |
| OE-1 | Drop the 15-minute visibility reread | Dropped: no freshness target needs it. The app refreshes on open and on Update, and the saved line shows the age of the copy | §2.4, §5 |
| OE-2 | Drop the persisted epoch and `epochAdopted` | Dropped, together with the `connecting` record. A fresh epoch is still sent to `/connect` (the server requires it), but it is not stored, and the mint's `epoch` is ignored: no behaviour depended on it | §2.3, §5 |

## 0. Findings the owner must see first

1. **While the consent screen stays in Testing, nobody stays connected for more than 7 days.** Google says a Testing
   project gets refresh tokens that expire in 7 days (R-G1), and that authorizations by test users expire 7 days
   after consent (R-G2). The 2026-11-06 spike ran in a single day, so it could not see this (R-11).
   **Recommendation, owner decision OD-S1b-1:** after S1b is accepted, switch the publishing status to *In
   production*, still unverified. People see the same warning. The cap becomes 100 new users in total, and the 7-day
   expiry goes away. The cost is that the test-user allowlist goes too. S1b handles the expiry either way, by asking
   the person to connect again (A-19 measures it).
2. **Conflict over who removes the canary.** `DEPLOYMENT.md:177` and `functions/api/google/canary/index.ts:1` say S1c;
   the task and the v7.1 fragment say S1b. This design follows the task (§2.7). If the owner wants the canary kept
   until S1c, only §2.7 is dropped.
3. **Disconnect is account-wide, not device-wide.** Revocation is grant-wide (R-11, R-G3), so Disconnect on one device
   cuts Weeklid off on every device connected with the same Google account. That holds only if the OAuth project
   serves nothing but Weeklid (OD-S1b-2: owner to confirm). The copy says so (§3).
4. **The privacy draft becomes false once the flag is on.** `docs/privacy-google-calendar.md:25` says "There is no
   Weeklid server". S1b rewrites it in the same PR.

## 1. Research (read 2026-11-06)

Repository facts were checked at `8d6b6cb`. External sources are primary docs. Only documentation pages were
fetched; no Google or Cloudflare production endpoint was called.

| # | Constraint relied on | Source |
|---|---|---|
| R-1 | `POST /connect` body exactly `{from:'app'\|'canary', epoch:<22 base64url>}` → `200 {url}`; sets `__Host-wl_dev` (Strict, ~400 d) and `__Host-wl_gflow` (Lax, 600 s) | `server/google/handlers.ts:58-107`, `:22-27`, `server/google/http.ts:102-104` |
| R-2 | A presented device id is adopted by `/connect` only when it already has a credential | `handlers.ts:69-77` |
| R-3 | `GET /callback` always answers `303` to `${APP_ORIGIN}/?google=<result>#/settings/calendars`. The results form a closed set: `connected cancelled state denied auth exchange noRefreshToken missingScope storage disabled notConfigured canary error` | `handlers.ts:112-127`, `:120` |
| R-4 | Without `GOOGLE_CLIENT_SECRET` the callback answers `canary`/`cancelled` and never exchanges the code | `handlers.ts:158-159`, `server/google/config.ts:37-38` |
| R-5 | `POST /token` → `200 {accessToken, expiresIn, epoch, pending}`; `401 noDevice\|notConnected`; `401 reconnect` for **any** of a key mismatch, a decryption failure, a missing scope or `invalid_grant` (only the last deletes the credential); `503 notConfigured\|serverConfig\|storage\|disabled`; `502 googleUnavailable`; `500 error` | `handlers.ts:202-265`, `:219-228`, `:250-257` |
| R-6 | `POST /status` → `{gen, connected, pending}` | `handlers.ts:269-285` |
| R-7 | `POST /disconnect` body exactly `{revoke:boolean, gen}`, JSON; generation-fenced; results `confirmed\|unconfirmed\|forgotten\|none\|stale(+gen)`; it revokes only the token of the calling device's row | `handlers.ts:289-324` |
| R-8 | Every POST needs `X-Weeklid: 1`, `Origin` equal to the app origin, and `Sec-Fetch-Site` absent or `same-origin` | `http.ts:116-125` |
| R-9 | Credentials are keyed by device hash, not by Google account; a reconnect replaces without revoking | `server/google/connectionStore.ts:100-112`, `docs/calendars.md:119-125` |
| R-10 | Credential swept after 190 days idle; every mint touches it | `handlers.ts:27`, `:242`, `:247` |
| R-11 | Spike 2026-11-06: refresh works, access token lasts about 1 h, PKCE and the secret are enforced, **revocation is grant-wide** | `docs/calendars.md:131-146` |
| R-12 | Lock contract D15: `navigator.locks` `'weeklid-google'`, exclusive, 20 s to acquire, 15 s per task, no steal, no nesting, no unlocked fallback, released before navigating | `functions/api/google/canary/script.ts:1-38` |
| R-13 | Owner canary PASS (browser tabs) on desktop Chrome, iPhone Safari and Android Chrome; home-screen icons untested | task context; `DEPLOYMENT.md:201-205` |
| R-14 | Today's client: GIS token model, token in tab memory, saved copy in IndexedDB `next168-google` with an epoch fence, cross-tab forget over BroadcastChannel | `src/features/calendars/google/useGoogleConnection.ts:13-16`, `:122`, `:187-191`, `:213-220`; `googleSavedEvents.ts:9-12` |
| R-15 | Delete all data erases the copy; `erase()` does nothing where the database is absent, and deletes the database when its transaction fails | `src/features/settings/data/DataSettings.vue:140`, `googleSavedEvents.ts:166-178` |
| R-16 | The service worker never caches or navigation-falls-back `/api/`; Google hosts go to the network only | `vite.config.ts:17`, `:19`, `:70-71` |
| R-17 | The manifest is `display: 'standalone'`, scope `./` | `vite.config.ts:49-55` |
| R-18 | CSP `connect-src 'self' https:` and allows the GIS script and frame; `form-action 'none'` does not affect `location.assign` | `index.html:4` |
| R-19 | CI fails if a build without a client ID references `api/google` or `gsi/client` | `.github/workflows/ci.yml:34-45` |
| R-20 | e2e fakes Google at its real addresses and runs against `vite preview` over `http://127.0.0.1` (no Functions) | `e2e/support/googleCalendar.ts:3-6`, `playwright.config.ts:19`, `:39` |
| R-21 | Five locales in parity, informal register | `src/features/calendars/google/googleCopy.spec.ts:4-5` |
| R-G1 | Testing → 7-day refresh tokens; 100 refresh tokens per account per client, the oldest invalidated silently; tokens also stop working when revoked, after 6 months unused, or when time-based access ends | https://developers.google.com/identity/protocols/oauth2 (read 2026-11-06) |
| R-G2 | Testing: up to 100 test users, authorizations expire 7 days after consent. Production unverified: an unverified-app warning and 100 new users in total | https://support.google.com/cloud/answer/15549945 (read 2026-11-06) |
| R-G3 | `access_type=offline` with `prompt=consent` gives a refresh token; `invalid_grant` means expired or invalidated, so authenticate again; revoking removes the whole authorization | https://developers.google.com/identity/protocols/oauth2/web-server (read 2026-11-06) |
| R-W1 | Safari deletes all script-writable storage (IndexedDB, localStorage) after 7 days of use without interaction with the site; home-screen apps keep their own counter | https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (read 2026-11-06) |
| R-A1 | iOS home-screen web apps have "separate cookies and storage from the browser"; links outside the scope open in Safari View Controller; OAuth staying in the app is described as a "heuristic" | https://developer.apple.com/videos/play/wwdc2023/10120/ (read 2026-11-06) |
| R-C1 | Pages: `_routes.json` `include` decides which paths invoke Functions; with no matching Function the request falls back to static assets | https://developers.cloudflare.com/pages/functions/routing/ (read 2026-11-06) |

**Unknowns**, each tied to a check:
- U-1: whether the round trip from an installed app comes back into the same cookie context (gate G-1, A-18).
- U-2: whether a new consent on one device restarts the 7-day Testing clock for the other devices (A-19).
- U-3: how often Safari evicts storage. This is no longer safety-relevant: eviction now costs one Connect tap.

## 2. Minimal design

### 2.1 Shape

There is one change of dependency: **where the access token comes from**. Everything after that stays as it is: the
events read straight from the browser to `googleapis.com` (`googleApi.ts`), normalization, the saved copy and its
epoch fence, the BroadcastChannel forget, the ticket and generation rules, and AI as "Busy". The token sources are:

- `gis`: today's behaviour, unchanged.
- `server`: a new `serverConnection.ts` that calls the S1a routes. The refresh token never reaches the browser, and
  the access token stays in tab memory only.

Which source a tab uses:

| Build | Browser tab | Installed app (`display-mode: standalone`, or `navigator.standalone`) |
|---|---|---|
| no `VITE_GOOGLE_SERVER` | `gis` | `gis` |
| `VITE_GOOGLE_SERVER=1` | `server` | `gis`, with `installedNote` (§3) |
| `VITE_GOOGLE_SERVER=1` and `VITE_GOOGLE_SERVER_INSTALLED=1` (only after G-1 passes on both platforms) | `server` | `server` |

The choice is made once per page load, before the connection store starts. The GIS chunk is loaded only by a tab
that selected `gis`; a `server` tab never loads `gsi/client` (A-4).

### 2.2 Files

| File | Change |
|---|---|
| `src/features/calendars/google/serverConnection.ts` (new) | Transport: `post(path, body?)` with `X-Weeklid: 1`, `credentials:'same-origin'`, `cache:'no-store'`, JSON only when there is a body, a 15 s abort, and the R-12 lock (copied from the canary script before it is deleted). Every reply maps to a closed union (§2.5). Tokens are never logged or stored |
| `src/features/calendars/google/useGoogleConnection.ts` | Takes token acquisition out into a `TokenSource` port (`acquire(ticket)`); `update()`, `connect()` and `disconnect()` branch on the selected source; adds §2.3 and §2.4. The GIS code moves unchanged behind the `gis` source |
| `src/features/calendars/googleSavedEvents.ts` | One record in the same store, key `server`: `{state:'connected'}` or `{state:'forget', revoke:boolean}`, validated field by field. `erase()` also deletes this key and writes `{state:'forget', revoke:false}` where the database exists |
| `src/features/calendars/googleGate.ts` | `googleTokenSource()` (the table in §2.1) and `captureGoogleReturn()`, which reads and removes `?google=<result>` with `replaceState` (an unknown value becomes `unknown`) |
| `src/features/calendars/index.ts` | Calls `captureGoogleReturn()` before the store starts (the parameter is stripped in every client-ID build) |
| `GoogleConnectSheet.vue`, `GoogleCalendarSection.vue` | Server source: Continue runs §2.3 Connect, with no GIS preload. The new Disconnect copy (§3). Details shows the last `server` code. The `installedNote` shows when an installed app is on GIS mode |
| `env.d.ts`, `vite.config.ts` | Declare `VITE_GOOGLE_SERVER` and `VITE_GOOGLE_SERVER_INSTALLED`. The build fails on any value other than `1`, on either flag without a client ID, or on `INSTALLED` without `SERVER` |
| `.github/workflows/ci.yml` | One more build with a client ID and `VITE_GOOGLE_SERVER=1`, checked to contain both chunks only behind dynamic imports. The e2e build (client ID, no flag) is checked for no `api/google` |
| `src/i18n/{en,es,pt,de,fr}/calendars.json` | §3 |
| `docs/calendars.md`, `DEPLOYMENT.md`, `docs/privacy-google-calendar.md` | Server mode, gate G-1, merged steps D1+D3 (§2.8), canary gone. Privacy §4 and §8: an encrypted refresh token per device on Cloudflare D1, events never through it, Disconnect account-wide, a copy kept when Google ends access elsewhere (§2.3 R-e). A dated changelog row |
| Canary removal (§2.7) | Route files and their specs |
| `e2e/google-server.spec.ts`, `e2e/support/googleServer.ts` (new); `playwright.config.ts` | §4 |
| `server/google/clientContract.spec.ts` (new, node) | Feeds the real handler replies through the client's reply parser (A-2) |

No new server route, no server behaviour change, no D1 migration, no paid service, no timer.

### 2.3 Client connection state machine (server source)

The persisted record (key `server` in `next168-google`) survives a reload. The in-memory state is what the UI
shows.

| Record | Meaning | Boot behaviour |
|---|---|---|
| absent | No local claim (never connected, evicted, deleted) | **No server call.** Shows the saved copy if there is one, plus Connect |
| `connected` | This device connected | `POST /token`, then a read |
| `forget{revoke}` | A disconnect, or Delete all data, has not reached the server yet | `status` → `disconnect{revoke, gen}`; **never** `/token` |

```
 disconnected ──tap Connect──▶ probing: POST /token (under lock)
   ▲      ▲                      │ 200 → write connected → connected (the one-tap recovery)
   │      │                      │ 401 noDevice|notConnected|reconnect → POST /connect{from:'app', fresh epoch}
   │      │                      │      → release lock → location.assign(url)  … Google …
   │      │                      │      303 ?google=connected → write connected → minting → connected
   │      │                      │      ?google=<other> → disconnected + message (§2.5)
   │      │                      │ network/5xx/lock → disconnected + message (nothing written)
   │      │
   │      └─ minting (boot with connected record, or Update):
   │           200 → connected (token in RAM) │ 401 any → delete record, KEEP copy → needsReconnect
   │           network/5xx/disabled → connectedOffline (copy shown; the next boot or Update retries)
   │
   └── tap Disconnect: (1) delete the `connected` record ─ fails → disconnectStuck (nothing else happens)
                       (2) forget locally in every tab, delete the copy
                       (3) status → disconnect{revoke:true, gen}; a stale reply → one retry with the returned gen
                           confirmed|unconfirmed|none → disconnected (+ message)
                           otherwise → put forget{revoke:true} (best effort) → disconnectPending
```

Rules:

- **R-a: only an explicit tap creates a connection, and Disconnect closes first.** The app calls `/token` by itself
  only with a `connected` record, and that record is written only after a Connect tap succeeds. Disconnect's first
  step deletes the record. So the worst storage loss (eviction, a failed `forget` write, an offline Disconnect) can
  only leave the device **not connected**; it can never reconnect it silently. A Connect tap later may pick up a
  server credential that never got revoked. That is the person's explicit intent, and it costs one tap instead of a
  Google consent.
- **R-b: fail closed.** If step (1) fails (IndexedDB unusable), the app shows `disconnectStuck`, keeps the Disconnect
  action and the permissions link, and does not claim a disconnection. It still forgets in memory and deletes the copy
  as far as storage allows.
- **R-c: one lock.** Every server call runs under `'weeklid-google'` (R-12). Without `navigator.locks` nothing is sent
  and the app shows `lockUnavailable`.
- **R-d: tickets as today.** A mint or read result is used only while the connection generation, workspace id and
  planner generation match (`useGoogleConnection.ts:72-74`); a token minted before Disconnect is dropped.
- **R-e: no `/token` answer deletes the copy.** `reconnect` is ambiguous (R-5), and even `invalid_grant` is (R-G1). The
  copy stays with its age line until a deletion rule that belongs to this device: Disconnect, Delete all data, an
  import or restore, another workspace or zone, or a callback `missingScope` right after this device's own consent.
- **R-f: the access token.** It is reused until `expiresIn − 60 s`. A Calendar 401 with an older token triggers one
  re-mint; a 401 right after a fresh mint counts as `401` from the server above.
- The `epoch` sent to `/connect` is fresh and **not stored**; the `epoch` and `pending` fields of the mint reply are
  ignored.

### 2.4 When the server is called (no timers, no visibility trigger)

| Trigger | Call |
|---|---|
| App open | By record (§2.3 table); with no record, nothing |
| Update tap | Re-mint if the token has lapsed, then read |
| Connect, Disconnect | §2.3 |
| `?google=` on boot | `connected` → write the record, mint; other values → message only |

### 2.5 Mapping server answers

| Answer | State | Saved copy | Message key |
|---|---|---|---|
| `/token 200` | connected | replaced by the read | — |
| `/token 401 noDevice\|notConnected\|reconnect` on boot or Update | needsReconnect (record deleted) | **kept** | `reconnectNeeded` |
| same, on a Connect tap | → `/connect` → Google | kept | — |
| `503 disabled`, callback `disabled\|notConfigured\|canary` | connectedOffline / disconnected | kept | `serverPaused` |
| `503 notConfigured\|serverConfig\|storage`, `502`, `500`, `403`, `400` | connectedOffline | kept | `serverUnavailable` (code in Details) |
| network error / 15 s abort | connectedOffline | kept | none on boot; `network` on a tap |
| lock busy / unavailable | unchanged | kept | `busy` / `lockUnavailable` |
| callback `denied`, `cancelled` | disconnected | kept | `accessDenied` (existing) |
| callback `missingScope` | disconnected | deleted | `missingScope` (existing) |
| callback `state`, `auth`, `exchange`, `noRefreshToken`, `storage`, `error`, `unknown` | disconnected | kept | `connectFailed{code}` |
| disconnect `confirmed` | disconnected | deleted | `revokeConfirmed` |
| disconnect `unconfirmed` / `none` | disconnected | deleted | `revokeUnconfirmed` + permissions link |
| disconnect not delivered | disconnectPending | deleted | `disconnectPending` + permissions link |
| record delete failed | disconnectStuck | deleted where possible | `disconnectStuck` + permissions link |

### 2.6 Migrating from today's GIS client

- **No data migration.** The saved copy keeps `FORMAT 1`. After the flag flips, a browser tab with a GIS-era copy has
  no record, so it makes no call and shows the copy with Connect. The first server read replaces the copy.
- An open tab still running the old chunk keeps GIS mode until it reloads (the CSP still allows GIS).
- The old token-model grant and the new offline grant belong to the same client, so Disconnect's revoke covers both.
- **Rollback:** unset `VITE_GOOGLE_SERVER` and redeploy, and every tab is back on GIS mode. The `server` record is
  ignored, and server credentials sit unused until the 190-day sweep or the `DEPLOYMENT.md` purge. The hard stop is
  still removing `GOOGLE_SERVER_ENABLED` (`DEPLOYMENT.md:211-221`).

### 2.7 Removing the canary

Delete:
- `functions/api/google/canary/{index,script}.ts`;
- `server/google/canary.spec.ts`;
- the canary rows of `server/google/{guards,routes}.spec.ts`.

Then narrow `/connect`'s `from` to `'app'` (`handlers.ts:66`) and drop the canary callback target (`handlers.ts:142`)
with its specs (`callback.spec.ts:113-118`, `connect.spec.ts:133-136`). After that, `from:'canary'` answers
`400 badRequest`, and a canary pending row left from before the deploy redirects to the app's message (it expires
within 600 s).

Deliberately kept:
- the D1 `CHECK (return_to IN ('app','canary'))` (`connectionStore.ts:96`), because changing it needs a migration;
- the `canary` outcome for a missing secret (`handlers.ts:159`), which the app maps to `serverPaused`.

With the files gone, `GET /api/google/canary` falls back to the static assets (R-C1). These are the only server edits
in S1b, and they are removals.

### 2.8 Rollout (owner)

1. Merge S1b.
2. Set `GOOGLE_CLIENT_SECRET` and `VITE_GOOGLE_SERVER=1` (Production), retry the deployment, and run A-16 and A-17 in
   browser tabs.
3. **Gate G-1:** run A-18 on the iPhone and Android home-screen apps. Only if both pass, set
   `VITE_GOOGLE_SERVER_INSTALLED=1` and redeploy.
4. Track A-19 over the following 8 days.

The labs gate stays throughout.

## 3. User-facing copy (en, es; pt/de/fr follow, parity enforced by `messages.spec.ts`)

Unchanged keys: `connect`, `continue`, `readOnly`, `aiBusy`, `accessDenied`, `missingScope`, `disconnect`
("Disconnect" / "Desconectar"), `revokeConfirmed`. Changed and new keys:

| Key | en | es |
|---|---|---|
| `stayConnected` (sheet) | You connect once on this device and stay connected, also after closing Weeklid. For that, a Weeklid server keeps Google's permission for this device, encrypted. Your events never go through it: they come straight from Google to this device. | Conectas una vez en este dispositivo y sigues conectado, también después de cerrar Weeklid. Para eso, un servidor de Weeklid guarda cifrado el permiso de Google para este dispositivo. Tus eventos nunca pasan por él: llegan directo de Google a este dispositivo. |
| `deviceCopyServer` | A copy of your events is saved only on this device so you see them when you open Weeklid; it is deleted when you disconnect here. | Una copia de tus eventos se guarda solo en este dispositivo para verlos al abrir Weeklid; se borra al desconectar aquí. |
| `goesToGoogle` | You'll go to Google and come back here. | Irás a Google y volverás aquí. |
| `testingServer` (while Testing; removed by OD-S1b-1) | While the app is in testing, Google shows an unverified-app warning and asks you to connect again every 7 days. | Mientras la app está en prueba, Google muestra un aviso de app no verificada y te pide conectar de nuevo cada 7 días. |
| `disconnectTitle` | Disconnect Google Calendar? | ¿Desconectar Google Calendar? |
| `disconnectBodyServer` | Weeklid will lose access to this Google account. If you connected Weeklid with the same account on other devices, they will need to connect again. The copy of your events on this device is deleted now; copies on other devices stay until you disconnect there or delete their data. | Weeklid perderá el acceso a esta cuenta de Google. Si conectaste Weeklid con la misma cuenta en otros dispositivos, tendrán que conectarse de nuevo. La copia de tus eventos en este dispositivo se borra ahora; las de otros dispositivos se quedan hasta que desconectes allí o borres sus datos. |
| `messages.revokeUnconfirmed` (server) | Disconnected on this device. We couldn't confirm with Google that Weeklid lost access to your account: check your account permissions. | Desconectado en este dispositivo. No pudimos confirmar con Google que Weeklid perdió el acceso a tu cuenta: revisa los permisos de tu cuenta. |
| `messages.disconnectPending` | Disconnected on this device. Weeklid will finish removing its access to your Google account next time you open it online, or you can remove it now in your account permissions. | Desconectado en este dispositivo. Weeklid terminará de quitar su acceso a tu cuenta de Google la próxima vez que la abras con conexión, o puedes quitarlo ya en los permisos de tu cuenta. |
| `messages.disconnectStuck` | Couldn't disconnect on this device because its storage isn't responding. Try again, or remove Weeklid in your account permissions. | No se pudo desconectar en este dispositivo porque su almacenamiento no responde. Inténtalo de nuevo o quita Weeklid en los permisos de tu cuenta. |
| `messages.reconnectNeeded` | Google Calendar needs you to connect again. Your saved events stay, but they won't update until you do. | Google Calendar necesita que te conectes de nuevo. Tus eventos guardados se quedan, pero no se actualizan hasta que lo hagas. |
| `messages.serverPaused` | The Google Calendar connection is paused for now. Your saved events stay. | La conexión con Google Calendar está en pausa por ahora. Tus eventos guardados se quedan. |
| `messages.serverUnavailable` | Couldn't reach Weeklid's Google connection. Your saved events stay; try again later. | No pudimos llegar a la conexión de Google de Weeklid. Tus eventos guardados se quedan; inténtalo más tarde. |
| `messages.connectFailed` | Google didn't complete the connection ({code}). Try again. | Google no completó la conexión ({code}). Inténtalo de nuevo. |
| `messages.lockUnavailable` | This browser can't connect Google Calendar safely. Update it and try again. | Este navegador no puede conectar Google Calendar de forma segura. Actualízalo e inténtalo de nuevo. |
| `installedNote` (installed app on GIS mode) | In the app on your home screen, Google asks for permission again about every hour. To stay connected, open Weeklid in your browser. | En la app de tu pantalla de inicio, Google vuelve a pedir permiso más o menos cada hora. Para seguir conectado, abre Weeklid en tu navegador. |

`googleCopy.spec.ts:28-32` gains a server-mode twin: it asserts "Tus eventos nunca pasan por él" and "misma cuenta",
and asserts that no server-mode string in any locale says "todos tus dispositivos", "every device" or the equivalent
phrase.

## 4. Acceptance checks

The e2e harness extends the existing one:
- `e2e/support/googleServer.ts` answers `/api/google/*` through `context.route`, with a scripted fake whose reply
  shapes come from the S1a handler types (pinned by A-2).
- A third Playwright `webServer` builds with `VITE_GOOGLE_SERVER=1`.
- The callback is simulated by navigating to `/?google=<result>#/settings/calendars`.
- Calendar reads still hit the existing fake Google (R-20).
- Cookie and guard semantics are proven by the server suite and the canary (R-13).

| # | Check | How it is observed |
|---|---|---|
| A-1 | Every row of §2.5 maps to exactly that state, copy action and message | unit, table-driven, one case per row |
| A-2 | The client parser accepts the real replies of `connect`, `token` (ok, noDevice, notConnected, reconnect for key mismatch and invalid_grant, notConfigured), `status` and `disconnect` (all 5 results) | unit (node): `server/google/clientContract.spec.ts` over the S1a harness |
| A-3 | Every call sends `X-Weeklid: 1`, same-origin credentials and `no-store`, under `'weeklid-google'`; without `navigator.locks` nothing is sent | unit, plus the e2e request log |
| A-4 | Connect with no server credential: `/token` 401, then `/connect{from:'app', epoch}`, then navigation; GIS never loaded (`gisLoads === 0`); nothing of the epoch is stored | e2e |
| A-5 | Return `?google=connected` → `connected` record → mint → events; the parameter is gone from the address | e2e |
| A-6 | **Stays connected across a reload:** reload → exactly one `/token` and one read, no sheet, no consent | e2e |
| A-7 | **No silent adoption:** with no record, but a fake server that would answer `/token 200`, boot makes **zero** `/api/google` requests and shows Connect; one Connect tap → `/token 200` → connected, no navigation to Google | e2e |
| A-8 | No token persisted anywhere: storage, the Cache Storage scan and the console (pattern of `google-calendar.spec.ts:224-252`) | e2e |
| A-9 | `401 reconnect` on boot → copy still shown with its age line, `reconnectNeeded`, record gone, and no further boot call | e2e |
| A-10 | Offline or `502` on boot → copy shown, no banner; the next boot or Update retries | e2e (`route.abort`) |
| A-11 | Disconnect online: the record is deleted **before** the first request; `status`, then `disconnect{revoke:true, gen}`; `confirmed` → `revokeConfirmed`; the dialog text matches §3 | e2e |
| A-12 | Disconnect offline → `disconnectPending`; reload online → `disconnect` is sent and no `/token`. Then delete the `forget` record by hand (eviction) and reload → zero requests, Connect shown | e2e |
| A-13 | The record delete fails (IndexedDB stub rejects) → `disconnectStuck`, no "Disconnected" message, Disconnect still offered; a `stale` reply → one retry, a second → `disconnectPending` | unit |
| A-14 | Delete all data → the record is gone and `forget{revoke:false}` is written → the next boot sends `disconnect{revoke:false}` and no `/token` | e2e |
| A-15 | Build guards: a build without a client ID has no `api/google` and no `gsi/client`; a client-ID build without the flag has no `api/google`; the bad flag values of §2.2 fail the build | CI, plus a `viteConfig.spec.ts` case |
| A-16 | Canary gone: no `functions/api/google/canary`, `from:'canary'` → 400, the server suite is green; in production, `GET /api/google/canary` returns the app | unit, `routes.spec.ts`; production with the owner |
| A-17 | **Production, browser tabs** (desktop Chrome, iPhone Safari, Android Chrome): connect; reload; close and reopen the next day; still connected with no consent | production with the owner, codes only in `docs/calendars.md` |
| A-18 | **Gate G-1, installed apps** (iPhone home screen, Android home screen) on a build with `VITE_GOOGLE_SERVER_INSTALLED=1` on a preview the owner opens. Connect inside the installed app; the return lands **in the installed app** with Weeklid connected; force-close and reopen, still connected. A failure on either platform means `INSTALLED` is not set, the installed apps keep GIS mode with `installedNote`, and the result is recorded | production with the owner. Until it passes, e2e checks only that a standalone context selects `gis` and shows `installedNote` (emulated `display-mode`) |
| A-19 | **Account-wide disconnect and expiry:** two devices on the same Google account; Disconnect on A → B's next open gives `reconnectNeeded` and **keeps** its copy. In Testing, a device left alone gives `reconnectNeeded` at about day 7–8 (and U-2 is answered) | production with the owner, dated |
| A-20 | The privacy draft no longer says "no Weeklid server", and it describes the account-wide Disconnect and the copies kept on other devices | PR diff review |

A-18 needs the flag on a non-production origin. Pull-request previews have no Functions variables (`DEPLOYMENT.md:171`),
so the owner either runs G-1 on production with `INSTALLED=1` set temporarily, or adds the variables to one preview.
The owner chooses which (**OD-S1b-3**); production with an immediate revert is the cheaper option.

## 5. Rejected alternatives and over-engineering removed

- **The browser keeps the refresh token.** It would need the client secret in the browser. Rejected.
- **The server proxies Calendar data.** Events would pass through Weeklid. Rejected.
- **A GIS code-client popup instead of the redirect.** It needs server changes, and popups are fragile in installed
  apps. Rejected.
- **Silent adoption with no local record** (revision 1). Rejected after the red team (finding 1). The one Connect tap
  that replaces it is cheap, and it puts the person's intent before anything else.
- **A server-side disconnect tombstone.** It would be a new server state and a new route for a case that R-a already
  closes without one. Rejected.
- **Distinct server outcomes for `reconnect`.** None of them would prove the person withdrew access (R-G1), so the
  client would treat them all alike. Rejected (finding 2).
- **"Disconnect this device only"** (`revoke:false`). Deferred: "simple outside".
- **Server mode in installed apps before G-1.** Rejected (finding 4). So is platform sniffing to enable a single
  platform: both installed apps move together.
- **Removed as YAGNI:**
  - the 15-minute visibility reread;
  - the persisted epoch, `epochAdopted` and the `connecting` record;
  - background or interval refresh, Background Sync and push;
  - sharing tokens between tabs;
  - handling `pending`;
  - a "connected" broadcast;
  - retry loops (at most one `stale` retry);
  - a D1 migration for the canary `CHECK`;
  - Delete-all-data network calls.

## 6. What the red team should attack (round 2)

1. **R-a under concurrency.** One tab disconnects while another, holding a `connected` record it read earlier, starts
   a boot mint or an Update. Does the lock plus the tickets stop a token or a read from landing after the delete? Does
   the second tab ever write `connected` back?
2. **The one-tap recovery.** A Connect tap reuses a server credential whose Disconnect revoke never landed. Is anything
   shown or read that the person would not expect? Is the "Connect" wording honest when no Google screen appears?
3. **The callback return.** A crafted `/?google=connected` writes the `connected` record and makes one mint under the
   person's own cookie. Check that it cannot show a false state beyond "connect again", and that the parameter is
   removed before anything can capture it.
4. **Copy kept after an ambiguous `reconnect`.** Is keeping it acceptable under the privacy draft and the Google API
   Services User Data Policy, when the person revoked access at `myaccount.google.com`?
5. **Selecting the installed context.** Can `display-mode` detection misfire (iPadOS, desktop installed apps,
   Android TWA) and put an installed app on the server path before G-1?
6. **Guards.** `Origin` and `Sec-Fetch-Site` on older iOS Safari; whether the CI chunk checks fail on a regression (try
   a mutant).
7. **Canary removal** with pending rows created before the deploy.
8. **Over-engineering.** Is the `forget` record still worth its tests, given that R-a makes it only a retry aid?
