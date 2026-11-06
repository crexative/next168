# Permanent Google connection, slice S1b: the app client

Status: **proposed**, awaiting adversarial review (risk tier: critical, auth/credentials). No implementation until
the red team's blockers are absorbed. Written 2026-11-06 against `main` 8d6b6cb (S1a server merged at 9e2be62).

Goal: a person connects Google Calendar once per device and stays connected across reloads and app restarts, using
the already-deployed S1a server. Google Calendar stays read-only, primary calendar only. The approved design v7.1 is
lost, so this document rebuilds S1b from the server that actually shipped. Three fragments of v7.1 survive and are
kept: "S1b: client server mode", "S1b (the client; it also deletes the canary route; critical)", and "refresh on open
and on return after 15 minutes".

## 0. Findings the owner must see first

1. **While the consent screen stays in Testing, nobody stays connected for more than 7 days.** Google: a Testing
   project "is issued a refresh token expiring in 7 days" (R-G1), and "Authorizations by a test user will expire seven
   days from the time of consent" (R-G2). The 2026-11-06 spike happened on a single day, so it could not see this
   (R-11). S1b handles the expiry correctly: it sends the person to connect again and deletes the copy of their
   events, because Google answers `invalid_grant` both for an expired token and for a revoked one. Even so, the
   promise "connect once" holds for at most a week. **Recommendation:** once S1b is accepted, switch the publishing
   status to *In production* and stay unverified. People see the same unverified-app warning. The cap becomes 100 new
   users in total (R-G2), close to today's 100 test users, and the 7-day expiry goes away. The cost is that the test
   user allowlist goes too: anyone with a Google account who opens the labs link can connect, up to the cap. That is
   owner decision **OD-S1b-1**. S1b does not depend on it. Check A-19 measures the expiry either way.
2. **Conflict over who removes the canary.** `DEPLOYMENT.md:177`, `functions/api/google/canary/index.ts:1` and
   `server/google/canary.spec.ts:2` say "removed by S1c". The surviving v7.1 fragment and this task say S1b. This
   design follows the task (§2.7) and updates those three lines. If the owner wants the canary kept until S1c, §2.7 is
   the only part to drop.
3. **The privacy draft becomes false once the flag is on.** `docs/privacy-google-calendar.md:25` says "There is no
   Weeklid server". S1b changes that text in the same PR, and the flag is not turned on before that change merges.

## 1. Research (read 2026-11-06, UTC 18:50)

Repository facts were checked at `8d6b6cb`. External sources are primary docs. Only documentation pages were
fetched; no Google or Cloudflare production endpoint was called.

| # | Constraint relied on | Source |
|---|---|---|
| R-1 | Routes: `POST /connect` body exactly `{from:'app'\|'canary', epoch:<22 base64url>}` → `200 {url}` and sets `__Host-wl_dev` (Strict, ~400 d) and `__Host-wl_gflow` (Lax, 600 s) | `server/google/handlers.ts:58-107`, `:22-27`, `server/google/http.ts:102-104` |
| R-2 | A presented device id is adopted only when it already has a credential, otherwise a new id is minted | `handlers.ts:69-77` |
| R-3 | `GET /callback` always answers `303` to `${APP_ORIGIN}/?google=<result>#/settings/calendars`; the results form a closed set (`connected cancelled state denied auth exchange noRefreshToken missingScope storage disabled notConfigured canary error`) | `handlers.ts:112-127`, `:120` |
| R-4 | Without `GOOGLE_CLIENT_SECRET`, the callback answers `canary` (or `cancelled`) and never exchanges the code | `handlers.ts:158-159`, `server/google/config.ts:37-38` |
| R-5 | `POST /token` (no body) → `200 {accessToken, expiresIn, epoch, pending}`; `401 noDevice\|notConnected\|reconnect`; `503 notConfigured\|serverConfig\|storage\|disabled`; `502 googleUnavailable`; `500 error`. On `invalid_grant` it deletes this device's credential | `handlers.ts:202-265` |
| R-6 | `POST /status` → `{gen, connected, pending}`; with no cookie, `gen:'-.-'` | `handlers.ts:269-285` |
| R-7 | `POST /disconnect` body exactly `{revoke:boolean, gen}`, JSON content type; generation-fenced; results `confirmed\|unconfirmed\|forgotten\|none\|stale(+gen)` | `handlers.ts:289-324`, `connectionStore.ts:127-128` |
| R-8 | Every POST needs `X-Weeklid: 1`, `Origin` = app origin, and `Sec-Fetch-Site` absent or `same-origin` | `http.ts:116-125` |
| R-9 | A reconnect replaces the device's refresh token **without revoking** the old one (revocation is grant-wide) | `connectionStore.ts:112`, `docs/calendars.md:119-125` |
| R-10 | The credential is swept after 190 days idle; every mint touches it | `handlers.ts:27`, `:242`, `:247` |
| R-11 | Spike 2026-11-06: refresh works, access token lasts about 1 h, PKCE and the secret are enforced, **revocation is grant-wide** (P4), so Disconnect removes Google from every device (O-6) | `docs/calendars.md:131-146` |
| R-12 | The canary's lock contract (D15): `navigator.locks` `'weeklid-google'`, exclusive, 20 s to acquire, 15 s per task, no steal, no nesting, no unlocked fallback, lock released before navigating to Google | `functions/api/google/canary/script.ts:1-38` |
| R-13 | Owner canary PASS on desktop Chrome, iPhone Safari and Android Chrome: the round trip and the Strict device cookie work, so a fetch after returning from Google carries the cookie (`notConnected`, not `noDevice`). Home-screen icons are **untested** | task context; `DEPLOYMENT.md:201-205` |
| R-14 | Today's client: GIS token model, token kept in tab memory, saved copy in IndexedDB `next168-google` with an epoch fence, cross-tab forget over `BroadcastChannel('next168-google')` | `src/features/calendars/google/useGoogleConnection.ts:13-16`, `:122`, `:187-191`, `:213-220`; `googleSavedEvents.ts:9-12` |
| R-15 | Delete all data erases the copy in every build | `src/features/settings/data/DataSettings.vue:140`, `googleSavedEvents.ts:45-47` |
| R-16 | The service worker never serves `/api/` from cache and never answers a navigation there; Google hosts go to the network only | `vite.config.ts:17`, `:19`, `:70-71` |
| R-17 | The CSP allows `connect-src 'self' https:`; `form-action 'none'` does not affect `location.assign` | `index.html:4` |
| R-18 | CI already fails if a build **without** a client ID references `api/google` or `gsi/client` | `.github/workflows/ci.yml:34-45` |
| R-19 | `VITE_GOOGLE_SERVER` is reserved for this slice as a build variable, owner step D3 | `DEPLOYMENT.md:172`, `:195` |
| R-20 | The e2e suite fakes Google at its real addresses and runs against `vite preview` over `http://127.0.0.1` (no Functions) | `e2e/support/googleCalendar.ts:3-6`, `playwright.config.ts:19`, `:39` |
| R-21 | Five locales must stay in parity, informal register | `src/features/calendars/google/googleCopy.spec.ts:4-5` |
| R-G1 | Testing → 7-day refresh tokens; a limit of 100 refresh tokens per account per client, oldest silently invalidated; tokens may stop working (revoked, 6 months unused, time-based access): "write your code to anticipate" it | https://developers.google.com/identity/protocols/oauth2 (read 2026-11-06) |
| R-G2 | Testing: up to 100 test users, authorizations expire 7 days after consent. Production unverified: unverified-app warning, 100 new users in total | https://support.google.com/cloud/answer/15549945 (read 2026-11-06) |
| R-G3 | `access_type=offline` returns a refresh token, and a second one needs `prompt=consent`. A revoked or expired token gives `invalid_grant` ("authenticate the user again"). Revocation covers the whole authorization | https://developers.google.com/identity/protocols/oauth2/web-server (read 2026-11-06) |
| R-W1 | Safari deletes **all script-writable storage (IndexedDB, localStorage, …)** after 7 days of Safari use without interaction with the site. Home-screen web apps keep their own counter. The article does not cover HttpOnly server cookies | https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/ (read 2026-11-06) |
| R-C1 | Pages: `_routes.json` `include` decides which requests invoke Functions; when no Function matches, the request falls back to static assets | https://developers.cloudflare.com/pages/functions/routing/ (read 2026-11-06) |

**Unknowns**, each turned into a check: (U-1) whether the OAuth round trip from an iOS or Android **home-screen**
icon comes back into the installed app with the same cookie jar (A-18); (U-2) whether a new consent on one device
restarts the 7-day clock for the person's other devices in Testing (A-19); (U-3) the real share of devices whose
script storage Safari evicts (not measured; §2.3 recovers on its own).

## 2. Minimal design

### 2.1 Shape

There is one change of dependency: **where the access token comes from**. Everything after that stays as it is: the
events read straight from the browser to `googleapis.com` (`googleApi.ts`), normalization, the saved copy and its
epoch fence, the BroadcastChannel forget, the ticket and generation rules, and AI as "Busy". The token sources are:

- `gis`: today's behaviour, unchanged, used when the build lacks `VITE_GOOGLE_SERVER=1`. It is also the rollback.
- `server`: a new `serverConnection.ts` that calls the S1a routes. With `VITE_GOOGLE_SERVER=1` the GIS script is never
  loaded.

The mode is decided at build time (`GOOGLE_SERVER_MODE = VITE_GOOGLE_CLIENT_ID && VITE_GOOGLE_SERVER === '1'`), never
at runtime, so each build carries one auth path. The access token stays in tab memory only, as today. The refresh
token never reaches the browser.

### 2.2 Files

| File | Change |
|---|---|
| `src/features/calendars/google/serverConnection.ts` (new) | Transport: `post(path, body?)` with `X-Weeklid: 1`, `credentials:'same-origin'`, `cache:'no-store'`, JSON only when there is a body, 15 s abort. Every call runs under the R-12 lock contract (copied from the canary script before it is deleted). It maps every reply to a closed union (§2.5) and never logs or stores a token |
| `src/features/calendars/google/useGoogleConnection.ts` | Takes token acquisition out into a `TokenSource` port (`acquire(ticket)`, `release()`); `update()` and `disconnect()` branch on the mode; adds the state machine in §2.3 and the triggers in §2.4. The GIS code moves unchanged behind the `gis` source |
| `src/features/calendars/googleSavedEvents.ts` | Adds one record in the same store, key `server`: `{state:'connected'\|'connecting', epoch}` or `{state:'forget', revoke:boolean}`, validated field by field like the copy. `erase()` (Delete all data) writes `{state:'forget', revoke:false}` with its new marker, only where the database exists |
| `src/features/calendars/googleGate.ts` | `captureGoogleReturn()`: reads and removes `?google=<result>` from the address with `replaceState`, like `captureLabsFlag`. An unknown value becomes `unknown`. Compiled in every client-ID build and ignored when server mode is off |
| `src/features/calendars/index.ts` | Calls `captureGoogleReturn()` behind `GOOGLE_SERVER_MODE`, before the connection store starts |
| `src/features/calendars/google/GoogleConnectSheet.vue`, `GoogleCalendarSection.vue` | Server mode: Continue → `/connect` → `location.assign(url)`, with no GIS preload. The Disconnect confirmation uses the "every device" copy (§3). Details shows the last `server` code |
| `src/features/settings/data/DataSettings.vue` | No new call: the `forget` record from `erase()` is the whole change |
| `env.d.ts`, `vite.config.ts` | Declare `VITE_GOOGLE_SERVER`. The build fails if it is set to anything other than `1`, or set without a client ID |
| `.github/workflows/ci.yml` | One more build with a client ID and `VITE_GOOGLE_SERVER=1`: it fails if `dist/assets` references `gsi/client`. The e2e build (client ID, no flag) is checked for no `api/google` |
| `src/i18n/{en,es,pt,de,fr}/calendars.json` | §3 keys. The `deviceCopy` claim "never goes through a Weeklid server" stays true for **events** only, so its server-mode variant says so (§3) |
| `docs/calendars.md`, `DEPLOYMENT.md`, `docs/privacy-google-calendar.md` | Server mode, merged steps D1+D3 (§2.8), canary gone, privacy §4/§8 rewritten (an encrypted refresh token per device on Cloudflare D1; events never pass through it), with a dated changelog row |
| Canary removal (§2.7) | `functions/api/google/canary/{index,script}.ts` deleted, plus their specs |
| `e2e/google-server.spec.ts`, `e2e/support/googleServer.ts` (new); `playwright.config.ts` | §4 |
| `server/google/clientContract.spec.ts` (new, node) | Feeds the **real** handler replies (S1a harness, fake Google) through the client's reply parser (§4, A-2) |

No new server route, no D1 migration, no paid service, no timer, no Background Sync.

### 2.3 Client connection state machine (server mode)

The persisted record (`server` key) is what survives a reload. The in-memory state is what the UI shows.

| Persisted record | Meaning |
|---|---|
| absent | No local claim. On boot, `/token` may **adopt** a server credential (recovery after Safari eviction, R-W1) |
| `connecting{epoch}` | A connect was started here; we are waiting for `?google=` |
| `connected{epoch}` | This device believes it is connected |
| `forget{revoke}` | Disconnect or Delete all data must still reach the server. It beats adoption |

```
                 tap Continue                      303 ?google=connected
  disconnected ───────────────▶ connecting ─────────────────────────────▶ minting
     ▲   ▲   (POST /connect ok →    │  ?google=<other> / POST /connect fails     │
     │   │    write connecting,     └──────────────▶ disconnected + message      │
     │   │    release lock, assign)                                             ▼
     │   │                    200: write connected{server epoch}        ┌── connected ──┐
     │   │                ┌───────────────────────────────────────────── │ (token in RAM)│
     │   │                │                                              └──────┬────────┘
     │   │             minting ◀── boot / return after 15 min / Update ─────────┘
     │   │                │  401 notConnected|noDevice: clear record, keep copy  → disconnected
     │   │                │  401 reconnect: clear record, delete copy everywhere → needsReconnect
     │   │                │  network / 5xx / disabled / lock busy               → connectedOffline
     │   │                ▼                                                     (copy shown, retried on next trigger)
     │   └──── disconnecting: write forget{revoke:true} + forget locally everywhere FIRST,
     │          then status → disconnect{revoke:true,gen}; stale → retry once with returned gen
     │          confirmed|unconfirmed|none → clear record → disconnected (+ message)
     │          network / 5xx / second stale  → keep forget record → disconnectPending
     └──────── disconnectPending/forget record: on boot and on return, POST status → disconnect{revoke, gen}
```

Rules that make it safe:

- **R-a: forget wins.** When the record is `forget`, no `/token` call is made. Its disconnect runs first, and only a
  terminal answer (`confirmed`, `unconfirmed`, `forgotten`, `none`) clears it. So an offline Disconnect is never
  silently undone by adoption on the next boot.
- **R-b: the epoch.** `/connect` sends a fresh 22-character base64url epoch, written as `connecting{epoch}` *before*
  `location.assign`. When `/token` returns a different epoch (two tabs raced on Connect, or the storage was evicted),
  the server's epoch is adopted and stored, and diagnostics record `epochAdopted`. The epoch never allows or blocks
  data access; the server's cookie and credential do. Rejected: the strict reject (§5).
- **R-c: one lock.** Every server call takes `'weeklid-google'` (R-12). Without `navigator.locks` the client calls
  nothing and shows `lockUnavailable`. There is no unlocked fallback.
- **R-d: tickets as today.** A mint or read result is used only while the connection generation, workspace id and
  planner generation still match (`useGoogleConnection.ts:72-74`). A token minted before Disconnect is dropped. A
  token from our server cannot be revoked one by one, and revoking it would be grant-wide, which Disconnect does
  anyway.
- **R-e: the copy.** Every existing deletion rule stays (`docs/calendars.md:108`). `reconnect` counts as "Google
  withdrew the permission" (it is `invalid_grant`, R-G3), so it deletes the copy here and in other tabs. A 7-day
  Testing expiry therefore deletes it too (§0.1). `notConnected` and `noDevice` keep the copy and show Connect.
- **R-f: the access token.** It is reused until `expiresIn − 60 s`, and a 401 from Calendar with a token minted
  earlier triggers one re-mint. A 401 right after a fresh mint is treated as `reconnect`.

### 2.4 When the server is called (no timers)

| Trigger | Call |
|---|---|
| App open (labs on, server mode) | The `forget` record, if any; otherwise one `POST /token` (also when there is no record: that is how adoption works). A device that never connected gets `401 noDevice`, from our own origin only; **Google is not contacted** |
| `visibilitychange` → visible, last successful read more than 15 min ago | Read again (re-mint if the token has lapsed); a pending `forget` is retried |
| Update tap | Read again (re-mint if needed) |
| Connect, Disconnect | §2.3 |
| `?google=` on boot | `connected` → mint. Every other value → message (§2.5), clear `connecting` |

`pending` in the mint reply is ignored (YAGNI).

### 2.5 Mapping server answers

| Answer | State | Copy | Message key |
|---|---|---|---|
| `200` token | connected | kept, then replaced by the read | — |
| `401 noDevice` / `notConnected` | disconnected | kept (stale line) | `serverNotConnected` (only if a record existed) |
| `401 reconnect` | needsReconnect | **deleted everywhere** | `reconnectNeeded` |
| `503 disabled` | connectedOffline | kept | `serverPaused` |
| `503 notConfigured` / `serverConfig` / `storage`, `502 googleUnavailable`, `500 error`, `403 forbidden`, `400 badRequest` | connectedOffline | kept | `serverUnavailable` (+ code in Details) |
| network error / 15 s abort | connectedOffline | kept | none on boot; `network` on a tap |
| lock busy / unavailable | unchanged | kept | `busy` / `lockUnavailable` |
| callback `connected` | → minting | — | — |
| callback `denied` / `cancelled` | disconnected | kept | `accessDenied` (existing) |
| callback `missingScope` | disconnected | deleted | `missingScope` (existing) |
| callback `state`, `auth`, `exchange`, `noRefreshToken`, `storage`, `error`, `unknown` | disconnected | kept | `connectFailed{code}` |
| callback `disabled`, `notConfigured`, `canary` | disconnected | kept | `serverPaused` |
| disconnect `confirmed` | disconnected | deleted | `revokeConfirmedAll` |
| disconnect `unconfirmed` / `none` | disconnected | deleted | `revokeUnconfirmedAll` + permissions link |
| disconnect `forgotten` (Delete all data) | — | (already erased) | — |
| disconnect still pending | disconnectPending | deleted | `disconnectPending` + permissions link |

### 2.6 Migrating from today's GIS client

- **No data migration.** The saved copy keeps `FORMAT 1` and its binding. After the flag flips, a device with a GIS-era
  copy boots, its `/token` answers `noDevice`, and it shows the copy with its "updated … ago" line plus **Connect**.
  The first server read replaces the copy.
- An open tab still running the old chunk keeps GIS mode until it reloads (the CSP still allows GIS). Nothing on
  the server depends on it.
- The person's existing GIS token-model grant and the new offline grant belong to the same client. Disconnect's
  grant-wide revoke covers both.
- **Rollback** means unsetting `VITE_GOOGLE_SERVER` and redeploying: back to GIS mode. GIS mode ignores the `server`
  record (the reader only reads the copy and epoch keys), and server credentials sit unused until the 190-day sweep or
  the `DEPLOYMENT.md` purge. The hard stop is still `GOOGLE_SERVER_ENABLED` removal (`DEPLOYMENT.md:211-221`).

### 2.7 Removing the canary

Delete `functions/api/google/canary/index.ts` and `script.ts`, `server/google/canary.spec.ts`, and the canary rows of
`server/google/{guards,routes}.spec.ts`. Narrow `/connect`'s `from` to `'app'` (`handlers.ts:66`) and drop the
canary callback target (`handlers.ts:142`) together with its specs (`callback.spec.ts:113-118`, `connect.spec.ts:133-136`).
After that, a `from:'canary'` request answers `400 badRequest`. **Server changes kept separate and deliberately not
made:** the D1 `CHECK (return_to IN ('app','canary'))` (`connectionStore.ts:96`) stays, because changing it needs a
migration and buys nothing. The `canary` outcome for a missing secret (`handlers.ts:159`) stays, because it is what
"secret absent" means, and the app maps it to `serverPaused`. With the files gone, `GET /api/google/canary` matches no
Function and falls back to the static assets (R-C1).

### 2.8 Rollout (owner)

Steps D1 (secret) and D3 (flag) merge into one step, since the canary is gone. The order is: merge S1b, set
`GOOGLE_CLIENT_SECRET` and `VITE_GOOGLE_SERVER=1` (Production), retry the deployment, then run checks A-15 to A-19.
The labs gate stays, so only opted-in devices see the feature.

## 3. User-facing copy (en, es; pt/de/fr follow, with parity enforced by `messages.spec.ts`)

Unchanged keys: `connect`, `continue`, `readOnly`, `aiBusy`, `accessDenied`, `missingScope`. New keys, and variants
for server mode:

| Key | en | es |
|---|---|---|
| `stayConnected` (sheet) | You connect once on this device and stay connected, also after closing Weeklid. For that, a Weeklid server keeps Google's permission for this device, encrypted. Your events never go through it: they come straight from Google to this device. | Conectas una vez en este dispositivo y sigues conectado, también después de cerrar Weeklid. Para eso, un servidor de Weeklid guarda cifrado el permiso de Google para este dispositivo. Tus eventos nunca pasan por él: llegan directo de Google a este dispositivo. |
| `deviceCopyServer` | A copy of your events is saved only on this device so you see them when you open Weeklid; it is deleted when you disconnect. | Una copia de tus eventos se guarda solo en este dispositivo para verlos al abrir Weeklid; se borra al desconectar. |
| `goesToGoogle` (under Continue) | You'll go to Google and come back here. | Irás a Google y volverás aquí. |
| `testingServer` (while Testing; dropped by OD-S1b-1) | While the app is in testing, Google shows an unverified-app warning and asks you to connect again every 7 days. | Mientras la app está en prueba, Google muestra un aviso de app no verificada y te pide conectar de nuevo cada 7 días. |
| `disconnect` | Disconnect | Desconectar |
| `disconnectTitleAll` | Disconnect Google Calendar on all your devices? | ¿Desconectar Google Calendar en todos tus dispositivos? |
| `disconnectBodyAll` | Google will stop sharing your calendar with Weeklid on **every device** where you connected it, not only this one. Weeklid deletes the copy of your events on this device now, and on your other devices the next time they open Weeklid. To use it again, you connect each device again. | Google dejará de compartir tu calendario con Weeklid en **todos los dispositivos** donde lo conectaste, no solo en este. Weeklid borra ahora la copia de tus eventos en este dispositivo, y en los demás la próxima vez que abran Weeklid. Para volver a usarlo, conectas cada dispositivo otra vez. |
| `disconnectConfirmAll` (button) | Disconnect everywhere | Desconectar en todos |
| `messages.revokeConfirmedAll` | Disconnected on all your devices. Google confirmed it withdrew access. | Desconectado en todos tus dispositivos. Google confirmó que retiró el acceso. |
| `messages.revokeUnconfirmedAll` | Disconnected on this device. We couldn't confirm it with Google, so your other devices may still be connected: check your account permissions. | Desconectado en este dispositivo. No pudimos confirmarlo con Google, así que tus otros dispositivos podrían seguir conectados: revisa los permisos de tu cuenta. |
| `messages.disconnectPending` | Disconnected on this device. Weeklid will finish disconnecting from Google next time you're online. | Desconectado en este dispositivo. Weeklid terminará de desconectarse de Google la próxima vez que tengas conexión. |
| `messages.reconnectNeeded` | Google asks you to connect again. The copy of your events on this device was deleted. | Google te pide conectar de nuevo. Se borró la copia de tus eventos en este dispositivo. |
| `messages.serverNotConnected` | This device is no longer connected to Google Calendar. Connect it again to update your events. | Este dispositivo ya no está conectado a Google Calendar. Conéctalo de nuevo para actualizar tus eventos. |
| `messages.serverPaused` | The Google Calendar connection is paused for now. Your saved events stay. | La conexión con Google Calendar está en pausa por ahora. Tus eventos guardados se quedan. |
| `messages.serverUnavailable` | Couldn't reach Weeklid's Google connection. Your saved events stay; try again later. | No pudimos llegar a la conexión de Google de Weeklid. Tus eventos guardados se quedan; inténtalo más tarde. |
| `messages.connectFailed` | Google didn't complete the connection ({code}). Try again. | Google no completó la conexión ({code}). Inténtalo de nuevo. |
| `messages.lockUnavailable` | This browser can't connect Google Calendar safely. Update it and try again. | Este navegador no puede conectar Google Calendar de forma segura. Actualízalo e inténtalo de nuevo. |

`googleCopy.spec.ts:28-32` asserts "nunca pasa por servidores de Weeklid". It gains a server-mode twin that asserts
the events-only claim ("Tus eventos nunca pasan por él") and asserts that the Disconnect title and body say "todos"
and "every device".

## 4. Acceptance checks

The e2e harness extends the existing one. `e2e/support/googleServer.ts` answers `/api/google/*` through
`context.route` with a scripted fake whose reply shapes are generated from the S1a handler types. A third Playwright
`webServer` builds with `VITE_GOOGLE_SERVER=1` on its own port. The callback is simulated by navigating to
`/?google=<result>#/settings/calendars`. Calendar reads still hit the existing fake Google (R-20). Cookie and guard
semantics are proven by the server suite and the owner canary (R-13), not by e2e.

| # | Check | How it is observed |
|---|---|---|
| A-1 | Every server reply in §2.5 maps to exactly the state, copy action and message in that table | unit: `serverConnection.spec.ts`, table-driven, one case per row; reverting any row fails |
| A-2 | The client parser accepts the **real** replies of `connect`, `token` (ok, noDevice, notConnected, reconnect, notConfigured), `status` and `disconnect` (all 5 results) | unit (node): `server/google/clientContract.spec.ts` drives handlers through the S1a harness and fake Google |
| A-3 | Every call sends `X-Weeklid: 1`, same-origin credentials and `no-store`, and runs under `'weeklid-google'`; without `navigator.locks` nothing is sent | unit, plus e2e request log |
| A-4 | Connect: one `/connect` with `{from:'app', epoch}`, the `connecting` record written before `location.assign`, and GIS never loaded (`gisLoads === 0`) | e2e |
| A-5 | Return `?google=connected` → mint → events shown; the parameter is gone from the address | e2e |
| A-6 | **Stays connected across a reload**: reload → exactly one `/token`, a fresh read, no Connect sheet, no Google consent | e2e |
| A-7 | Return after 15 min re-reads (clock advanced); a return after 14 min does not; no timer fires while hidden | e2e (clock control) |
| A-8 | No token is persisted anywhere: storage, the Cache Storage scan and the console hold no `accessToken` value (A8 pattern of `google-calendar.spec.ts:224-252`) | e2e |
| A-9 | `401 reconnect` on boot → copy deleted in this tab and another open tab → Connect shown with `reconnectNeeded` | e2e (two pages) |
| A-10 | Offline or `502` on boot → copy shown, no error banner, state connectedOffline; the next return retries | e2e (`route.abort`) |
| A-11 | Disconnect → `status`, then `disconnect{revoke:true, gen}`; local forget happens before the network; `confirmed` → `revokeConfirmedAll`; the confirmation text says every device | e2e |
| A-12 | Disconnect offline → `disconnectPending`; reload online → `disconnect` sent **before any `/token`**, no adoption | e2e |
| A-13 | `stale` → one retry with the returned gen; a second `stale` → `disconnectPending` | unit |
| A-14 | Delete all data → `forget{revoke:false}` record → the next boot sends `disconnect{revoke:false}` and no `/token` | e2e |
| A-15 | Build guards: a build without a client ID has no `api/google` and no `gsi/client`; a client-ID build without the flag has no `api/google`; a flag build has no `gsi/client`; `VITE_GOOGLE_SERVER=yes` fails the build | CI (`ci.yml`), plus a `viteConfig.spec.ts` case |
| A-16 | The canary is gone: no `functions/api/google/canary`, `from:'canary'` → 400; `server` suite green | unit, `routes.spec.ts`; production `GET /api/google/canary` returns the app, not the canary (owner) |
| A-17 | **Production full path** on desktop Chrome, iPhone Safari and Android Chrome: connect, reload, close and reopen the next day, still connected with no consent; Details shows server `ok` | production with the owner, recorded in `docs/calendars.md` (codes only) |
| A-18 | The same on the **iPhone and Android home-screen icons** (U-1). If the round trip does not come back into the installed app, S1b ships with the labs note "connect from the browser" and the defect is recorded; no workaround is built in S1b | production with the owner |
| A-19 | **Grant-wide disconnect and expiry**: two devices connected; Disconnect on A → B's next open gives `reconnectNeeded` and deletes its copy. In Testing, a device left alone gives `reconnectNeeded` at about day 7–8 (U-2: does a consent on B extend A?) | production with the owner, dated |
| A-20 | The privacy draft no longer claims "no Weeklid server" and describes the encrypted per-device permission | review of the PR diff; `grep` in CI is not worth adding |

## 5. Rejected alternatives and over-engineering removed

- **The browser keeps the refresh token.** Impossible without a secret in the browser; and stealable. Rejected.
- **The server reads events and proxies Calendar data.** The person's events would pass through Weeklid, which
  breaks the privacy promise and widens the breach scope. Rejected: only the access token crosses our server.
- **A GIS code-client popup instead of a full-page redirect.** It would need server changes (a postMessage
  redirect), and popups are fragile in installed apps. Rejected; the server already returns a redirect URL.
- **A runtime fallback to GIS inside server mode.** Two auth paths in one build double the attack surface and the
  tests. Rejected: one mode per build, and rollback is a redeploy.
- **Strict epoch rejection** (refuse a credential whose epoch differs from the local one). Safari deletes script
  storage after 7 days without use (R-W1) while the HttpOnly cookie survives, so the strict rule would force a
  needless reconnect. Rejected in favour of adoption plus the `forget` record (R-a, R-b).
- **A second button, "disconnect this device only"** (`revoke:false`). Useful, but "simple outside", and O-6 says
  Disconnect means everywhere. Deferred.
- **Removed as YAGNI:** background or interval refresh, Background Sync and push; sharing tokens between tabs over
  BroadcastChannel (each tab mints at most about once an hour); handling `pending` from `/token`; a "connected"
  broadcast (the return trigger covers it); retry loops (at most one `stale` retry); a D1 migration for the canary
  `CHECK`; a new `/forget` route; Delete-all-data network calls (the record covers them).

## 6. What the red team should attack

1. **Adoption versus intent.** Can any path re-adopt a credential after the person disconnected or deleted all data?
   Think about Safari evicting the `forget` record before it is delivered, a private window, or two tabs (one
   disconnecting, one booting) without the lock. Is "forget wins" enforceable when storage writes fail?
2. **Lock gaps.** Is a mint that starts before a Disconnect, under the lock, still able to publish a token or events
   after it? Check the ticket rules against the order lock → network → ticket check.
3. **The callback return.** Is `?google=connected` forgeable? A link to `/?google=connected` only triggers a mint
   under the person's own cookie, so check it cannot show a "connected" state that is false or leak anything. And is
   the parameter removed before any analytics or share link could capture it?
4. **CSRF and the guards.** R-8 relies on `Origin` and `Sec-Fetch-Site`. Check older iOS Safari behaviour and
   installed-app contexts, and whether any client call could be made cross-site.
5. **Grant-wide revoke across devices.** Is the copy-deletion promise ("on your other devices the next time they open
   Weeklid") true when the other device is offline for months? Is `reconnect` (copy deleted) too aggressive for
   transient Google errors, given that only `invalid_grant` maps to it (`handlers.ts:252-257`)?
6. **The 7-day Testing expiry.** Is shipping S1b in Testing honest given the copy? Is OD-S1b-1 (unverified
   production) safe with an empty allowlist and a lifetime cap of 100?
7. **Home-screen apps (U-1).** If iOS returns the OAuth redirect into Safari instead of the installed app, the cookie
   lands in a different jar. Does the client fail clearly, or does it loop?
8. **Build-flag leaks.** Can `GOOGLE_SERVER_MODE` be true in a GitHub Pages, preview or companion build? Do the CI
   greps actually fail on a regression? Mutate the guard and see.
9. **Canary removal.** Does narrowing `from` break a pending row created with `return_to='canary'` before the deploy
   (TTL 600 s)? Is there any remaining reference to the canary target?
10. **Rollback that lies.** After unsetting the flag, the server keeps refresh tokens no client uses. Is the purge
    procedure still correct, and does the GIS-mode copy say nothing false about a server?
11. **Over-engineering.** Is the `connecting` record needed, or is the callback result plus `/token` enough? Is the
    15-minute return rule worth its test cost?
