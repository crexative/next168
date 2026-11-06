# Permanent Google connection, slice S1b: the app client

Status: **proposed, revision 5**; risk tier critical (auth/credentials). Earlier revisions: `a3a5613`,
`8e5fea2`, `c7d5791` and `e9deeff` (2026-11-06). This revision is against `main` 8d6b6cb (S1a server merged at 9e2be62).

**Goal.** A person connects Google Calendar once per device and stays connected across reloads and restarts, through
the deployed S1a server. Google Calendar stays read-only, primary calendar only. The lost v7.1 design survives in two
fragments: "client server mode" and "it also deletes the canary route; critical".

**What the person gives up in server mode (stated plainly).** Weeklid no longer saves Google events on the device.
Each time it opens, it asks the server for a token and reads the events again. **Without internet, Google events are
not shown:** Week and Today say so, and AI prompts made offline carry no Google meetings. In a server build, the
contexts that still use today's GIS mode (installed apps before G-1, in-app browsers) stop saving the copy too
(4-3); only a build without the flag keeps it.

## Round 3 resolution: simplification (Codex REJECT on `c7d5791`)

Coordinator decision, KISS/YAGNI, which the owner may veto: remove the machinery added in rounds 2–3 instead of
fencing it again.

| # | Round-3 finding | Resolution | Mechanism removed |
|---|---|---|---|
| 1 | A tombstone retry does not clear the local record or copy | Gone: there are no tombstones, no `connected` record and no saved copy in server mode | localStorage tombstones, offline Disconnect retry, `connected` record |
| 2 | Delete all data's prefix wipe erases a concurrent tombstone | Gone, as in #1. Delete all data calls the server online and otherwise tells the person what remains (§2.4) | tombstones |
| 3 | The epoch fence does not cover the copy reader (`keepMatchingCopy`) | Gone: server mode never reads or writes the copy. The first thing a server-mode boot does is `erase()` the GIS-era copy (§2.5) | the persisted copy in server mode, `saveConnected`, `fencedCheck`, the fenced-mutations table |
| 4 | Clearing a same-value tombstone | Gone, as in #1 | tombstones |
| 5 | Positive browser detection matches embedded WebViews | Replaced by an **explicit allowlist** of top-level Safari, Chrome, Edge and Firefox tabs. Everything else, in-app WebViews included, stays on GIS. The doc states where a WebView cannot be told apart (§2.1) | the display-mode-only heuristic |
| 6 | "Only while connected" does not settle the cache-header rule | Moot in server mode: nothing is stored. OD-S1b-4 is withdrawn for every context of a server build (4-3) and remains only for builds without the flag | retention rule R-e |
| 7 | INFO: callback-commit race during Delete all data or Disconnect | Still relevant (both call the server): server test A-12 | — |

### Round 4 resolution (Codex ACCEPT WITH CHANGES on `e9deeff`): small edits, no new mechanism

| # | Round-4 finding | Resolution | Where |
|---|---|---|---|
| 4-1 | A late read can follow a Disconnect | The claim "a stale tab can only under-connect" is dropped. The residual is now stated: a token already minted, or a Google read already in flight, in another tab or on another device, can still finish and show events, for up to the token's lifetime (about 1 h) for new reads, and until reload for what is already on screen. The bounded guarantee is that **no new mint succeeds afterwards and nothing is persisted**. A-11 holds a minted `/token` reply, a Google read and a second device across the Disconnect | §2.3, A-11 |
| 4-2 | A missing device cookie looks like a successful cleanup | Client-only. `/status` and `/disconnect` cannot tell "no cookie" from "no credential" (both give `-.-` and `none`), but `/token` can: `noDevice` before storage, `notConnected` once the credential is read as absent and before any Google call (`handlers.ts:210`, `:220`). After a `none`, the client sends one `/token`; on `noDevice` it never claims cleanup and shows `googleAccessMayRemain` with the permissions link. No server change | §2.4, §3, A-13 |
| 4-3 | The GIS copy survives in mixed modes | Copy persistence is off in **every** context of a server build: the GIS source keeps events in memory only too. Every boot in a server build, in any context, runs `erase()` (idempotent). The privacy claim is widened to match, and A-7 covers a browser tab plus an installed app | §2.2, §2.5, A-6, A-7 |
| 4-4 | The installed gate contradicts the allowlist | Two branches: a **browser-tab branch** (the allowlist), and an **installed-app branch** admitted only when `VITE_GOOGLE_SERVER_INSTALLED=1`, with its own pinned signals. A-18 checks that branch | §2.1, A-14, A-18 |

Kept from earlier rounds:
- **R1-2:** neutral copy on any `/token` 401.
- **R1-3:** honest, account-wide Disconnect copy, plus owner assumption OD-S1b-2.
- **R1-4:** installed apps gated by G-1.
- **R2-6:** the flag matrix.
- **R2-7:** the canary pending-row test.
- **R2-5 changed:** the conditional Connect copy becomes **unconditional**. Connect now always goes to Google,
  because the one-tap `/token` probe is gone (a boot already mints), so "you'll go to Google" is true every time.

Rounds 1–2 rows that described removed mechanisms (adoption, the `connected` record, tombstones, epoch-fenced
writes, copy retention) are superseded by this table. The commits above keep their history.

## 0. Owner decisions

1. **OD-S1b-1: the 7-day Testing expiry.** In Testing, nobody stays connected for more than 7 days (R-G1, R-G2).
   Recommendation: after S1b is accepted, move to *In production*, unverified. People see the same warning, the cap is
   100 new users in total, the 7-day expiry goes away, and so does the allowlist.
2. **OD-S1b-2:** confirm the OAuth project serves only Weeklid, because Disconnect is account-wide.
3. **OD-S1b-3:** where to run gate G-1 (production with an immediate revert, or a preview with variables).
4. **Canary owner:** the docs say S1c (`DEPLOYMENT.md:177`), the task says S1b. This design follows the task (§2.6).
5. **Veto of this simplification:** losing Google events offline in server mode (above).

The privacy draft says "There is no Weeklid server" (`docs/privacy-google-calendar.md:25`); S1b rewrites it.

## 1. Research (read 2026-11-06)

Repository facts were checked at `8d6b6cb`. Only documentation pages were fetched; no Google or Cloudflare
production endpoint was called.

| # | Constraint relied on | Source |
|---|---|---|
| R-1 | `POST /connect{from, epoch}` → `200 {url}`; sets `__Host-wl_dev` (Strict) and `__Host-wl_gflow` (Lax, 600 s); adopts a presented device id only when it already has a credential | `server/google/handlers.ts:58-107`, `:69-77` |
| R-2 | `GET /callback` → `303` to `${APP_ORIGIN}/?google=<result>#/settings/calendars` (closed set); a credential row is created **only** here, from this device's pending row | `handlers.ts:118-198`, `connectionStore.ts:114` |
| R-3 | `/token`: `200 {accessToken, expiresIn, …}`; `401 noDevice` before any storage access; `401 notConnected\|reconnect`; `5xx`. Its writes (`touch`, `rotate`) are conditional on the credential's connection id | `handlers.ts:202-265`, `:236-247`, `connectionStore.ts:118-119` |
| R-4 | `/status` → `{gen, …}`; `/disconnect{revoke, gen}` is generation-fenced, deletes this device's credential or pending row, then revokes; `confirmed\|unconfirmed\|forgotten\|none\|stale` | `handlers.ts:269-324`, `connectionStore.ts:125-126` |
| R-5 | POST guards: `X-Weeklid: 1`, `Origin`, `Sec-Fetch-Site` absent or same-origin | `http.ts:116-125` |
| R-6 | Credentials are keyed by device hash; 190-day idle sweep | `connectionStore.ts:100-112`, `handlers.ts:27` |
| R-7 | Spike: refresh works, access token about 1 h, revocation is grant-wide | `docs/calendars.md:131-146` |
| R-8 | Lock contract D15 (`'weeklid-google'`, exclusive, 20 s/15 s, no fallback) | `functions/api/google/canary/script.ts:1-38` |
| R-9 | Today's client: GIS, token in tab memory, saved copy, cross-tab forget over BroadcastChannel, tickets | `useGoogleConnection.ts:72-74`, `:122`, `:213-220`; `googleSavedEvents.ts` |
| R-10 | Delete all data erases the copy and wipes `next168-` keys, the labs flag included | `DataSettings.vue:140`, `src/features/settings/data/deviceData.ts:11` |
| R-11 | Manifest `display: 'standalone'`; the service worker leaves `/api/` and Google hosts to the network | `vite.config.ts:17-19`, `:49-55`, `:70-71` |
| R-12 | CI checks a build without a client ID for `api/google` and `gsi/client` | `.github/workflows/ci.yml:34-45` |
| R-13 | e2e fakes Google, over `vite preview` on `http://127.0.0.1` | `e2e/support/googleCalendar.ts:3-6`, `playwright.config.ts:39` |
| R-G1 | Testing → 7-day refresh tokens; tokens also die when revoked, after 6 months unused, or past 100 per account | https://developers.google.com/identity/protocols/oauth2 (read 2026-11-06) |
| R-G2 | Testing: 100 test users, 7-day authorizations; production unverified: a warning and 100 new users in total | https://support.google.com/cloud/answer/15549945 (read 2026-11-06) |
| R-G3 | `invalid_grant` = expired or invalidated; revocation removes the whole authorization | https://developers.google.com/identity/protocols/oauth2/web-server (read 2026-11-06) |
| R-P1 | Workspace user-data policy: "Honor user requests to delete their data"; documentation must explain "how users can manage and delete their data"; no "permanent copies … longer than permitted by the cache header" | https://developers.google.com/workspace/workspace-api-user-data-developer-policy (read 2026-11-06) |
| R-A1 | iOS home-screen apps: "separate cookies and storage from the browser"; OAuth staying in the app is a "heuristic" | https://developer.apple.com/videos/play/wwdc2023/10120/ (read 2026-11-06) |
| R-M1 | UA tokens: Chrome adds `CriOS/` on iPhone; Edge `Edg/` (desktop), `EdgA/` (Android), `EdgiOS/` (iPhone); Firefox `Firefox/`; Safari `Version/…` (+ `Mobile` on iPhone); "non-Apple iPhone browsers … are still based on WebKit" | https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent (read 2026-11-06) |
| R-C1 | Pages: with no matching Function, a request falls back to static assets | https://developers.cloudflare.com/pages/functions/routing/ (read 2026-11-06) |

**Not verified by a primary source:** that the Android WebView adds a `wv` token, or reports the brand
`"Android WebView"` in `navigator.userAgentData`. Two attempts to find Chrome's own page failed (a 404 and an
unrelated page). The allowlist does not rely on either signal to *admit* a context. A-17 observes real in-app
WebViews.

## 2. Minimal design

### 2.1 Context allowlist (fail-safe to GIS)

Common preconditions: `VITE_GOOGLE_SERVER=1`, the labs flag on, a secure context, not the companion (the gate as
today), and a top-level window (`window.top === window`). The server source is then used when **one of the two
branches** holds; otherwise the tab uses GIS mode.

**Browser-tab branch.** `matchMedia('(display-mode: browser)').matches`, `navigator.standalone !== true`, a
`document.referrer` that does not start with `android-app://`, and the browser on the allowlist:

| Platform | Admitted when | Notes |
|---|---|---|
| Desktop, Android (Chromium) | `navigator.userAgentData.brands` contains `Google Chrome` or `Microsoft Edge` | WebViews and other Chromium browsers (Samsung Internet, Opera, Brave) do not carry those brands; unverified for WebViews, observed by A-17 |
| Desktop, Android (Firefox) | UA contains `Firefox/` and no `; wv)` | Firefox has no `userAgentData` |
| macOS Safari | UA contains `Version/` and `Safari/`, not `Chrome/` | — |
| iPhone/iPad | UA contains `Safari/` and either `Version/` (Safari), `CriOS/`, `EdgiOS/` or `FxiOS/`, and **none of** `FBAN`, `FBAV`, `Instagram`, `GSA/`, `Line/`, `WhatsApp` | **Limitation:** every iOS browser is WebKit (R-M1). An in-app WKWebView that sends a Safari-like UA without a marker cannot be told apart and would be admitted. The consequence is bounded: the round trip to Google may fail (`connectFailed`), and nothing is stored on the device in server mode |

**Installed-app branch**, only when `VITE_GOOGLE_SERVER_INSTALLED=1` (set after gate G-1):
- iPhone/iPad home-screen app: `navigator.standalone === true`. Only Safari's home-screen apps set it; an in-app
  WKWebView does not.
- Android or desktop installed app: `matchMedia('(display-mode: standalone)')` or `minimal-ui` or `fullscreen` matches
  **and** `navigator.userAgentData.brands` contains `Google Chrome` or `Microsoft Edge` (a WebAPK runs in Chrome).

Without `INSTALLED=1`, the branch is off: installed apps get GIS and the `installedNote`. The selection is a pure
function of the flags and these signals, with a table-driven unit test (A-14).

### 2.2 Files

| File | Change |
|---|---|
| `src/features/calendars/google/serverConnection.ts` (new) | `post()` with `X-Weeklid: 1`, same-origin credentials, `no-store`, a 15 s abort, the R-8 lock copied from the canary, and a closed reply mapping (§2.4); `forgetThisDevice(revoke)` = `status` → `disconnect{revoke, gen}`, with one retry on `stale` |
| `useGoogleConnection.ts` | A `TokenSource` port (`gis` \| `server`). In a server build **both** sources keep events in memory only: `saved()` is a no-op port, so `loadMatching` returns nothing and `save` writes nothing. Today's tickets and BroadcastChannel forget stay |
| `googleGate.ts` | `googleTokenSource()` (§2.1); `captureGoogleReturn()` strips `?google=` |
| `src/features/calendars/index.ts` | Any server build, any context: strip `?google=` and call `savedGoogleEvents().erase()` on every boot, before the store starts |
| `DataSettings.vue` | Server build: Delete all data runs `forgetThisDevice(false)` (5 s, plus the `noDevice` probe of §2.4) before the existing wipe; the result picks the message (§3) |
| Sheet and section `.vue` | Connect → `/connect` → `location.assign`; Disconnect disabled while `navigator.onLine === false`; a Google line on Week and Today for "unavailable offline"; Details shows the selected source and the last server code |
| `env.d.ts`, `vite.config.ts`, `ci.yml` | The flag matrix (§2.7) |
| i18n (5 locales), `docs/calendars.md`, `DEPLOYMENT.md`, privacy draft | §3; G-1; merged steps D1 and D3. Privacy §4 and §8: one encrypted permission per device on D1, events never through it and never stored on the device in any context of a server build, account-wide Disconnect, how to delete (and `googleAccessMayRemain`) |
| Canary removal, e2e, contract spec | §2.6, §4 |

No new server route, no server behaviour change beyond the canary removal, no D1 migration, no timer, and no new
persisted client state.

### 2.3 Connection (server source)

The only durable client state is today's labs flag. The device cookie and the D1 credential belong to the server.

```
 open ─▶ offline? ── yes ─▶ unavailable ("needs internet"; Update retries)
           │ no
           ▼
        POST /token (lock) ─ 200 ─▶ token in RAM ─▶ read ─▶ connected (events in RAM)
           │ 401 (any) ─▶ disconnected (Connect shown; reconnectNeeded only if this tab was connected)
           │ 5xx / network / disabled ─▶ unavailable (serverUnavailable | serverPaused); Update retries
 Connect ─▶ POST /connect{from:'app', fresh epoch} ─▶ release lock ─▶ location.assign(url) … Google …
           ─▶ 303 ?google=<result> ─▶ open (above); a result other than connected only adds its message
 Update  ─▶ re-mint if the token lapsed (expiresIn − 60 s), then read
 Disconnect (online only) ─▶ forgetThisDevice(true)
           confirmed | unconfirmed | none ─▶ forget in memory in every tab (broadcast) ─▶ disconnected + message
           network / 5xx / second stale ─▶ still connected, disconnectFailed ("try again")
```

**What Disconnect guarantees, and what it does not.**

The guarantee: **after a terminal Disconnect answer, no new mint for this device succeeds, and nothing Google is
persisted anywhere on any device.**
- Disconnect deletes this device's credential row before revoking (R-4), so a later `/token` answers `notConnected`.
- A row is created only by a callback commit from a pending row, which only a Connect tap starts (R-2). `touch` and
  `rotate` are conditional on the connection id (R-3), so a late mint never re-creates or revives a row.
- No context of a server build persists events (§2.2).

The residual, stated rather than fenced. Event reads do not take the lock, and the lock does not span devices.
1. **Same device, another tab.** A `/token` reply already minted, or a Google read already in flight, can finish
   after the Disconnect. With BroadcastChannel, the forget bumps that tab's generation and aborts its requests, so
   the result is dropped. Without it, the tab shows those events and can read again with that token until it
   expires, about 1 h.
2. **Another device on the same account.** It keeps what is on screen until it reloads or reads again. A new read
   succeeds only while its access token is live and Google has not invalidated it. A confirmed revoke ends that at
   once (R-G3); an unconfirmed one does not, and the Disconnect message says so, with the permissions link. Its next
   mint fails with `reconnect` once Google has revoked the grant.

Neither case can mint again or persist anything.

**Retained rules:** no `/token` answer changes anything durable; access tokens stay in memory and are never logged;
without `navigator.locks` nothing is sent (`lockUnavailable`).

### 2.4 Disconnect and Delete all data need the network

| Action | Online | Offline |
|---|---|---|
| Disconnect | `forgetThisDevice(true)`; local forget only after a terminal answer | The button is disabled with `disconnectNeedsNetwork`; a `/disconnect` that does not get through leaves the tab connected and shows `disconnectFailed` |
| Delete all data (server build, any source, labs on or off) | `forgetThisDevice(false)` first (this device's permission goes; other devices keep theirs), then the wipe | The wipe runs anyway; the message `deleteAllGoogleOffline` names what remains and links to `https://myaccount.google.com/connections` |

**A missing device cookie (4-2).** With no cookie, `/status` answers `gen:'-.-'` and `/disconnect` answers `none`.
A cookie with no credential gives the same answers (`handlers.ts:276`, `:302`, `:321`), so `none` alone proves
nothing. `/token` distinguishes them without contacting Google: `noDevice` when there is no cookie (`handlers.ts:210`),
`notConnected` once the credential is read as absent (`:220`). So after a `none`, the client sends one `/token`:

| `/token` after `none` | Meaning | Disconnect | Delete all data |
|---|---|---|---|
| `notConnected` | this device holds nothing on the server | `revokeUnconfirmed` + link (as before) | done, no Google message |
| `noDevice` | the cookie is gone, and a credential may still exist under it | `googleAccessMayRemain` + link; the tab still forgets in memory | wipe, then `googleAccessMayRemain` + link |
| `200` (a race with a new connect) | a credential exists | run `forgetThisDevice` once more; if it is still not terminal → `disconnectFailed` | as Disconnect, then the wipe |

A credential stranded behind a lost cookie can never be minted again (its device id is gone) and is swept after 190
days (R-6). The person is told to remove access at Google.

After an offline Delete all data, the wipe also removes the labs flag (R-10), so the app makes no server call until
the person opts in again. If they opt in again while the server still holds that device's credential, the next open
mints and connects. That is what `deleteAllGoogleOffline` promises ("access stays until you disconnect online"), and
the 190-day sweep (R-6) ends it otherwise.

### 2.5 Migration and rollback

- **Every boot of any context in a server build** erases the GIS-era copy (`erase()`, idempotent), and no context of
  a server build writes one again (4-3). So in a server build nothing Google is stored on the device, in a browser
  tab, an installed app or an in-app browser alike. The person loses the offline copy in the GIS contexts too; the
  `installedNote` says so. Only a build without `VITE_GOOGLE_SERVER` keeps today's copy.
- Old-chunk tabs keep GIS until they reload. Disconnect revokes both grants (same client).
- **Rollback:** unset `VITE_GOOGLE_SERVER` and redeploy, and every tab is on GIS mode. The server credentials sit
  unused until the sweep or the `DEPLOYMENT.md` purge. The hard stop is still removing `GOOGLE_SERVER_ENABLED`.

### 2.6 Removing the canary

Delete:
- `functions/api/google/canary/{index,script}.ts`;
- `server/google/canary.spec.ts`;
- the canary rows of `guards.spec.ts` and `routes.spec.ts`.

Then narrow `from` to `'app'` (`handlers.ts:66`) and drop the canary target (`handlers.ts:142`). Kept: the D1
`CHECK` (`connectionStore.ts:96`) and the missing-secret `canary` outcome (`handlers.ts:159`, mapped to
`serverPaused`). The new handler test inserts a `return_to='canary'` pending row, runs the callback after the
removal, and asserts `303` to `${APP}/?google=<result>#/settings/calendars`; `from:'canary'` answers `400`. With
the files gone, `GET /api/google/canary` falls back to static assets (R-C1).

### 2.7 Flag matrix

Values are unset, `''` (= unset) or `1`; anything else fails. Each row is a `viteConfig.spec.ts` case:

| CLIENT_ID | SERVER | INSTALLED | Build | CI bundle assertion |
|---|---|---|---|---|
| unset | unset | unset | ok | no `gsi/client`, no `api/google` (exists) |
| unset | 1 | any | fails | — |
| unset | unset | 1 | fails | — |
| set | unset | unset | ok | no `api/google` (the e2e build) |
| set | unset | 1 | fails | — |
| set | 1 | unset / 1 | ok | `api/google` and `gsi/client` absent from the entry `index-*.js`, each present in another chunk |
| any | other value | any | fails | — |
| any | any | other value | fails | — |

`googleTokenSource()` has a table-driven unit test over §2.1 × the three valid flag rows.

### 2.8 Rollout (owner)

1. Merge S1b.
2. Set `GOOGLE_CLIENT_SECRET` and `VITE_GOOGLE_SERVER=1`, redeploy, and run A-16 and A-17.
3. Gate G-1 (A-18). If it passes on both platforms, set `VITE_GOOGLE_SERVER_INSTALLED=1`.
4. A-19 over 8 days.

The labs gate stays throughout.

## 3. User-facing copy (en, es; pt/de/fr follow, parity enforced by `messages.spec.ts`)

Unchanged: `connect`, `continue`, `readOnly`, `aiBusy`, `accessDenied`, `missingScope`, `disconnect`, `disconnectTitle`,
`revokeConfirmed`.

| Key | en | es |
|---|---|---|
| `stayConnected` | You connect once on this device and stay connected, also after closing Weeklid. A Weeklid server keeps Google's permission for this device, encrypted. Your events never go through it and are not saved on this device: Weeklid reads them from Google each time you open it, so without internet you won't see them. | Conectas una vez en este dispositivo y sigues conectado, también después de cerrar Weeklid. Un servidor de Weeklid guarda cifrado el permiso de Google para este dispositivo. Tus eventos nunca pasan por él ni se guardan en este dispositivo: Weeklid los lee de Google cada vez que lo abres, así que sin internet no los verás. |
| `goesToGoogle` | You'll go to Google and come back here. | Irás a Google y volverás aquí. |
| `testingServer` (removed by OD-S1b-1) | While the app is in testing, Google shows an unverified-app warning and asks you to connect again every 7 days. | Mientras la app está en prueba, Google muestra un aviso de app no verificada y te pide conectar de nuevo cada 7 días. |
| `eventsOffline` (Week, Today) | Google Calendar needs internet: your tasks might land on top of meetings. | Google Calendar necesita internet: tus tareas podrían caer encima de reuniones. |
| `disconnectBodyServer` | Weeklid will lose access to this Google account. If you connected Weeklid with the same account on other devices, they will need to connect again. | Weeklid perderá el acceso a esta cuenta de Google. Si conectaste Weeklid con la misma cuenta en otros dispositivos, tendrán que conectarse de nuevo. |
| `disconnectNeedsNetwork` | Disconnecting needs internet. | Para desconectar necesitas internet. |
| `messages.disconnectFailed` | Couldn't disconnect: Weeklid didn't get an answer. You're still connected; try again. | No se pudo desconectar: Weeklid no recibió respuesta. Sigues conectado; inténtalo de nuevo. |
| `messages.revokeUnconfirmed` (server) | Disconnected on this device. We couldn't confirm with Google that Weeklid lost access to your account: check your account permissions. | Desconectado en este dispositivo. No pudimos confirmar con Google que Weeklid perdió el acceso a tu cuenta: revisa los permisos de tu cuenta. |
| `messages.reconnectNeeded` | This device is no longer connected to Google Calendar. Connect again to see your events. | Este dispositivo ya no está conectado a Google Calendar. Vuelve a conectar para ver tus eventos. |
| `messages.serverPaused` | The Google Calendar connection is paused for now. | La conexión con Google Calendar está en pausa por ahora. |
| `messages.serverUnavailable` | Couldn't reach Weeklid's Google connection. Try again later. | No pudimos llegar a la conexión de Google de Weeklid. Inténtalo más tarde. |
| `messages.connectFailed` | Google didn't complete the connection ({code}). Try again. | Google no completó la conexión ({code}). Inténtalo de nuevo. |
| `messages.lockUnavailable` | This browser can't connect Google Calendar safely. Update it and try again. | Este navegador no puede conectar Google Calendar de forma segura. Actualízalo e inténtalo de nuevo. |
| `deleteAllGoogleOffline` | Your data on this device was deleted, but Weeklid couldn't reach its server: its access to your Google Calendar stays until you disconnect online or remove Weeklid at myaccount.google.com/connections. | Se borraron tus datos de este dispositivo, pero Weeklid no pudo llegar a su servidor: su acceso a tu Google Calendar sigue hasta que desconectes con internet o quites Weeklid en myaccount.google.com/connections. |
| `googleAccessMayRemain` | Weeklid couldn't confirm that its access to your Google Calendar was removed. To be sure, remove Weeklid at myaccount.google.com/connections. | Weeklid no pudo confirmar que se quitó su acceso a tu Google Calendar. Para estar seguro, quita Weeklid en myaccount.google.com/connections. |
| `installedNote` | Here Google asks for permission again about every hour, and your events aren't saved between visits. To stay connected, open Weeklid in Safari, Chrome, Edge or Firefox. | Aquí Google vuelve a pedir permiso más o menos cada hora y tus eventos no se guardan entre visitas. Para seguir conectado, abre Weeklid en Safari, Chrome, Edge o Firefox. |

`googleCopy.spec.ts` gains server-mode cases. They assert "ni se guardan en este dispositivo", "misma cuenta" and
the link in `deleteAllGoogleOffline`. They also assert that no server-mode string says "todos tus dispositivos" or
"every device", or promises a copy of the events.

## 4. Acceptance checks

The e2e harness extends the existing one:
- `e2e/support/googleServer.ts` fakes `/api/google/*` through `context.route`; its shapes are pinned by A-2.
- A third `webServer` builds with `VITE_GOOGLE_SERVER=1`, and its contexts are made to match the allowlist.
- The callback is simulated by navigating to `/?google=<result>#/settings/calendars`.

| # | Check | How it is observed |
|---|---|---|
| A-1 | Each answer in §2.3/§2.4 → that state and message | unit, table-driven |
| A-2 | The client parser accepts the real replies of every route and outcome | unit (node), `server/google/clientContract.spec.ts` over the S1a harness |
| A-3 | Headers, credentials, `no-store` and the lock on every call; nothing is sent without `navigator.locks` | unit, plus the e2e request log |
| A-4 | Connect → `/connect{from:'app', epoch}` → navigation; `gisLoads === 0` | e2e |
| A-5 | **Stays connected:** `?google=connected`, then a reload → one `/token` and one read each time, no consent; the parameter is stripped | e2e |
| A-6 | **Nothing Google is persisted in a server build, in either source:** after connect and read in a server-source tab **and** in a GIS-source context (emulated installed app), IndexedDB `next168-google` holds no copy, and no storage, cache or console entry holds a token or an event title | e2e |
| A-7 | **Mixed modes (4-3):** with a seeded GIS-era copy, a boot of either a browser tab (server) or an emulated installed app (GIS) on the same origin deletes it. Then the installed app connects through GIS and reads, and a reload of each context finds no copy | e2e |
| A-8 | Offline at open → no request, `eventsOffline` on Week and Today; online, Update → events | e2e |
| A-9 | `/token 401` → Connect and the neutral message; `5xx` → `serverUnavailable`; `disabled` → `serverPaused` | e2e |
| A-10 | Disconnect: disabled offline; online → `status` + `disconnect{revoke:true, gen}`; local forget only after a terminal answer; a failed request → still connected, `disconnectFailed`; the dialog text matches §3 | e2e |
| A-11 | **Late results across a Disconnect (4-1).** The fake server follows R-4: after a Disconnect, every mint for that device answers `notConnected`, and the fake Google rejects that grant's tokens once the revoke is confirmed. (a) Tab B's `/token` is **minted** and its reply held; A disconnects; the reply is released. (b) Tab B's Google read is held; A disconnects; the read is released. (c) Device 2 (a second browser context, its own cookie jar) is connected and reading; device 1 disconnects with a confirmed revoke. In each case, assert the bounded outcome: with BroadcastChannel, (a) and (b) show nothing new; without it, they may show those events; (c) keeps what is on screen. In every case the next mint fails (`notConnected` or `reconnect`), and storage holds no Google data | e2e |
| A-12 | **Callback-commit race (R3-7), against the real handlers:** `/connect` makes a pending row; Delete all data's `status` + `disconnect{revoke:false, gen}` runs before the callback → the callback answers `cancelled` and no credential exists. Between `status` and `disconnect` a commit lands → `stale` → the retry deletes it | unit (node), S1a harness |
| A-13 | Delete all data online → `forget` before the wipe; offline → wipe, `deleteAllGoogleOffline` with the link; with the labs flag off and no `next168-google` database the call is still made. **No cookie (4-2):** `none` then `/token noDevice` → `googleAccessMayRemain` with the link and no success claim; `none` then `notConnected` → no Google message. The same two cases for Disconnect | e2e, plus a node case over the real handlers confirming the `noDevice`/`notConnected` split |
| A-14 | Flag matrix (§2.7) and `googleTokenSource()` matrix: each browser-tab row → `server`; WebView user agents → `gis`; an installed app → `gis` without `INSTALLED` and `server` with it (iOS `navigator.standalone === true`; Android/desktop `standalone` with a Chrome or Edge brand); an installed context with another brand → `gis` | unit, CI |
| A-15 | Canary gone; a pre-existing `return_to='canary'` row → `303` to the app; `from:'canary'` → 400 | unit; owner in production: `GET /api/google/canary` returns the app |
| A-16 | **Production, browser tabs** (desktop Chrome, iPhone Safari, Android Chrome): connect; reload; reopen the next day, still connected | production with the owner |
| A-17 | **Allowlist on real contexts:** Details → source reads `server` in those tabs and `gis` in the Instagram, Gmail and Facebook in-app browsers on iPhone and Android and in the home-screen apps. Any in-app context that reads `server` is recorded, and its marker is added to §2.1 | production with the owner |
| A-18 | **Gate G-1, installed-app branch:** on a build with `INSTALLED=1` (OD-S1b-3), Details → source reads `server` in each home-screen app. Connect there; the return lands in the app with it connected; still connected after a force-close. If either platform fails, `INSTALLED` stays unset and both apps keep `gis` | production with the owner |
| A-19 | Two devices on the same account: Disconnect on A → B's next open → `reconnectNeeded`. In Testing, `reconnectNeeded` at about day 7–8 | production with the owner, dated |
| A-20 | The privacy draft describes §2.3–§2.4 and how to delete (R-P1); no "no Weeklid server" | PR diff review |

## 5. Rejected alternatives and over-engineering removed

- **The browser keeps the refresh token**, or **the server proxies events**. Rejected.
- **A GIS code-client popup.** Rejected: server changes, fragile in installed apps.
- **Fencing the persisted copy, tombstones and silent adoption** (rounds 1–3). Removed: each patch exposed the next
  race (round 3).
- **A TTL tied to Google's cache header** for a server-mode copy. Rejected: there is no copy to age.
- **Display-mode-only detection.** Rejected for the allowlist.
- **Deferred:** "disconnect this device only"; an online-event auto-retry; server mode in installed apps (G-1).
- **YAGNI:** timers, visibility rereads, Background Sync, token sharing between tabs, a "connected" broadcast, a D1
  migration.

## 6. What the red team should attack (round 5)

1. The Disconnect guarantee in §2.3: find a mint or a persisted write that survives a terminal Disconnect, beyond the
   stated residual.
2. The allowlist: an admitted context that should be excluded, or a common real browser wrongly sent to GIS.
3. Delete all data offline, then opting in again: is the reconnect honest given `deleteAllGoogleOffline`?
4. The Android shared storage between a Chrome tab and the installed app (§2.5).
5. Whether losing offline Google events makes the free tier worse than today for its users (the owner's veto).
