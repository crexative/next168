# Accounts, sync across devices and each person's calendars

Status: **proposed, revision 1** (research and design only, no code). Risk tier critical (auth, credentials, personal
data, deletion). Written against `main` f77ebc0 (S1b merged). Every external page below was read on 2026-11-07 (UTC);
no Google, Apple or Cloudflare production endpoint was called and no secret was read.

**Goal.** A person can sign in with Google or Apple, see the same plan on every device where they are signed in, and
see their own calendars there. Nobody has to sign in: without an account Weeklid works exactly as it does today.

## 0. Owner decisions that block implementation

| # | Decision | Recommendation | Why |
|---|---|---|---|
| OD-1 | **Does this request change the 2026-10-25 decision** (free = local-only; accounts plus sync = premium, "next phase")? | **No.** Accounts and sync are the premium tier. The free tier stays local, with no sign-in and no new server call. Until payments exist, premium runs as an **invite-only beta of at most 100 people**, free of charge. | The request does not say accounts are free. Sync is the only feature with a recurring server cost, and the paid value. 100 matches Google's cap for an unverified app (R-G2), so the beta needs no Google verification. Stated plainly: since 2026-10-27 the free tier already has one small server dependency, the per-device Google permission (S1a/S1b). This design does not add another one. |
| OD-2 | **Spending: Apple Developer Program, USD 99 per year** (R-A2). Sign in with Apple cannot be set up without it (R-A1, R-A3). | **Approve it only after slices S1 to S3 are accepted** (Google accounts and sync working in the beta). Enroll as Crexative S.A.S. (organization: 100 website URLs instead of 10, R-A1). | Sign in with Apple gives **no access to iCloud Calendar** (§1.2), so its only value is a sign-in for people who do not want to use Google. Paying before the sync it unlocks exists buys nothing. This is spending: it needs your explicit approval. |
| OD-3 | **Google verification** (no fee). It is needed before a 101st person can connect Google Calendar (R-G2). | Submit it once S3 is accepted, with **every scope at once**: `openid email`, `calendar.events.readonly` and `calendar.calendarlist.readonly` (if OD-4 says yes). Your time: a public home page and privacy policy on the domain, Search Console domain verification and an unlisted YouTube demo video (R-G4). | One review instead of two. The review can take up to 10 days (R-G4). Forums report weeks, so start before the beta fills up. |
| OD-4 | **"Each person's calendars": only the primary Google calendar (today), or let the person pick other Google calendars?** | Yes, let them pick, read-only. It adds the `calendar.calendarlist.readonly` scope, which goes in the same verification (OD-3). | People keep work, family and shared calendars apart. Listing them needs that scope (R-G5). |
| OD-5 | **End-to-end encryption of the synced plan.** | **No in v1.** The server stores the plan encrypted with a Weeklid key (§3.3). The format is versioned so end-to-end encryption can be added later as an option. | With end-to-end encryption, losing the key means losing the plan, so every person would have to keep a recovery key ("simple outside"). It would also prevent the approved premium remote MCP "proposal inbox" from reading the plan. |
| OD-6 | **Who is responsible for the data, and where we sell.** | Crexative S.A.S. is the *Responsable* (data controller). Publish a *Política de Tratamiento* and collect consent at sign-up (§1.5). Treat GDPR as applicable, because the app ships in German and French (`src/i18n/index.ts:3`). Have a lawyer review the policy before the beta opens. | Ley 1581 requires prior, informed consent and a written policy. Offering the app in EU languages is the kind of targeting that brings GDPR in (R-L4). **A lawyer's review is also spending** and needs your approval. |
| OD-7 | **Price and payment provider** (blocks charging, not building). | Decide after the beta measures use. The repo's competitor research shows simple planners charging about USD 2.8–4.2 a month (Tweek) or USD 29.99 a year (Structured) (`docs/research/competitors-commercial.md:29`, `:32`). Infrastructure is not what drives the price (§2). | At 10,000 people, servers cost about USD 5 a month (§2). The Apple fee, payment fees and support cost far more than that. |

## 1. Dated research (read 2026-11-07)

### 1.1 Sign in with Apple on the web

| # | Finding | Source |
|---|---|---|
| R-A1 | The web needs a **Services ID** tied to a **primary App ID** with Sign in with Apple enabled. You register its domains and return URLs (up to 10 URLs for an individual, 100 for an organization). "You don't need to upload a file on your server" for domain verification | https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/ |
| R-A2 | "The Apple Developer Program is 99 USD per membership year". Sign in with Apple is listed among its capabilities ("apps and websites") | https://developer.apple.com/programs/whats-included/ |
| R-A3 | Free accounts are limited to Personal Team provisioning. "Certificates, Identifiers & Profiles" (where Services IDs live) is a program-only feature. The page does not name Sign in with Apple, so "it needs the paid membership" is inferred from R-A1 and R-A2 | https://developer.apple.com/support/compare-memberships/ |
| R-A4 | The token endpoint `https://appleid.apple.com/auth/token` takes `client_id`, `client_secret`, `code`, `grant_type` and `redirect_uri`, and returns `id_token`, an access token and a refresh token. `client_secret` is an ES256 JWT signed with a key from the developer account (the six-month maximum lifetime is confirmed only by secondary sources) | https://developer.apple.com/tutorials/data/documentation/signinwithapplerestapi/generate-and-validate-tokens.md |
| R-A5 | `POST https://appleid.apple.com/auth/revoke` invalidates a refresh or access token. **It needs a valid token**: "you can generate tokens when validating an authorization code" | https://developer.apple.com/tutorials/data/documentation/signinwithapplerestapi/revoke-tokens.md |
| R-A6 | Server-to-server notifications: `email-disabled`, `email-enabled`, `consent-revoked` and `account-deleted`, as JWS signed by Apple | https://developer.apple.com/tutorials/data/documentation/signinwithapple/processing-changes-for-sign-in-with-apple-accounts.md |
| R-A7 | Private relay: you can only email a relay address after registering your sending domains with SPF ("All registered domains must create Sender Policy Framework (SPF) DNS TXT records"); unregistered mail bounces | https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/ |
| R-A8 | App Review **4.8** (offer an equivalent private login when you offer Google) and **5.1.1(v)** ("If your app supports account creation, you must also offer account deletion within the app") apply to App Store apps and notarized iOS apps. Weeklid is a web PWA, so **neither binds it today**. They will if it ever ships through the App Store | https://developer.apple.com/app-store/review/guidelines/ (last updated 2026-10-16) |
| R-A9 | Apple's deletion guidance: delete "the entire account record, along with associated personal data"; deactivation alone "is insufficient"; Sign in with Apple apps "should use the Sign in with Apple REST API to revoke user tokens" | https://developer.apple.com/support/offering-account-deletion-in-your-app/ |
| R-W1 | Apple's documentation (secondary sources: forum, libraries) says that requesting the `name email` scope forces `response_mode=form_post`, so Apple **POSTs cross-site** to the return URL. A cookie with `SameSite=Lax` "is not sent" on a cross-site POST | https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie; https://developer.apple.com/forums/thread/118209 |

**Not verified by a primary source:** the exact scope and `response_mode` rules. Apple's page for the authorization
request rendered empty or returned 404 every time we tried. The S4 canary observes the real behaviour (§4).

### 1.2 Can Apple sign-in give access to iCloud Calendar?

**No.** Sign in with Apple returns only a stable `sub`, and on the first sign-in a name and an email address (which may
be a relay address). There is no calendar scope (R-A4, R-A6). The real options:

| Option | What the person does | Limits | Verdict |
|---|---|---|---|
| **Public iCloud calendar link** (an `.ics` subscription) | In iCloud Calendar, turns on *Public Calendar* and copies the link (https://support.apple.com/guide/icloud/share-a-calendar-mm6b1a9479/icloud) | Anyone with the link can read it; it is read-only; one link per calendar. A browser cannot fetch it directly (CORS); the iCloud holidays URL returned HTML (`docs/calendars.md:57`), and the general rule is that feeds send no CORS headers (`docs/calendars.md:59`). **It needs a same-origin proxy** | **Premium, S5** |
| **`.ics` file import** | Exports and imports a file | A one-time snapshot; no updates | Already free today |
| **CalDAV with an app-specific password** | Creates one at account.apple.com (requires two-factor authentication), up to 25 at a time, all revoked when the password changes (https://support.apple.com/en-us/102654) | The server would have to store a password that gives access to the person's iCloud data ("mail, contacts, and calendars"), not just one calendar. It is a broad, long-lived credential | **Rejected** (§5) |
| **"Authorize the app using your Apple Account"** | Only for "supported third-party apps" (https://support.apple.com/en-us/121539, published 2025-10-07) | We found no developer program or API for it | **Not available**; check again later |

### 1.3 Google sign-in on the existing client and the S1a server

| # | Finding | Source |
|---|---|---|
| R-G1 | Sign-in uses the same Web client: `scope=openid email`, authorization-code flow, PKCE. `sub` is the identifier ("Use `sub` … as the unique-identifier key"; email "may not be unique"). A token received directly from the token endpoint over HTTPS "really comes from Google" | https://developers.google.com/identity/openid-connect/openid-connect |
| R-G2 | Testing: 100 test users, 7-day authorizations. **Exception: apps that request only basic name, email and profile scopes skip the test-user list, the warning and the 7-day expiry.** In production but unverified, there is an "Unverified apps" warning for sensitive scopes and a cap of 100 new users "over the entire lifetime of the project" | https://support.google.com/cloud/answer/15549945 |
| R-G3 | Brand verification (home page, privacy policy, domains) applies to every app. Sensitive scopes add a use-case review, a demo video and a justification of the narrowest scope; only restricted scopes need the annual security assessment | https://support.google.com/cloud/answer/13464321 |
| R-G4 | Sensitive-scope verification: a privacy policy on the same domain as the home page, a public home page, Search Console domain verification, an unlisted YouTube video showing the consent screen and the client ID, a justification for each scope. It "can take up to 10 days" | https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification |
| R-G5 | `calendar.events.readonly`: "View events on all your calendars"; `calendar.calendarlist.readonly`: "See the list of Google calendars you're subscribed to". The page gives no sensitivity class; secondary sources call Calendar scopes sensitive, not restricted | https://developers.google.com/workspace/calendar/api/auth |
| R-G6 | Revoking a grant removes the whole authorization (S1b R-G3, R-7) | `docs/design/google-permanent-connection-s1b.md:85-87` |

**Repo facts.** The S1a server already does the code flow with PKCE and a client secret (`server/google/googleOAuth.ts:14-34`,
`:87-110`). It keeps pending rows keyed by a state hash (`connectionStore.ts:113`) and a Strict device cookie
`__Host-wl_dev` (`handlers.ts:22-24`). It guards POSTs with `X-Weeklid`, `Origin` and `Sec-Fetch-Site`
(`http.ts:113-116`), and seals tokens with AES-GCM under `GOOGLE_TOKEN_KEY` (`crypto.ts`, `config.ts:54-57`). Credentials
are keyed **per device** (`connectionStore.ts:100-112`). **So yes, sign-in can reuse the client** (one more redirect URI)
**and the server's modules** (`googleOAuth`, `crypto`, `http`, the D1 port). It needs its own route and its own scope
request, so a sign-in never asks for calendar access (and, by R-G2, a sign-in-only request needs no test users).
**Unverified:** whether a project whose consent screen lists a sensitive scope still gets the basic-scope exception
for a request that asks only for `openid email`. The S1 canary observes this.

### 1.4 Sync on Cloudflare

| Product | Free | Paid (Workers Paid, USD 5/month minimum) | Source |
|---|---|---|---|
| Workers / Pages Functions | 100,000 requests/day, 10 ms CPU | 10 M requests and 30 M CPU-ms/month included; USD 0.30 per extra million. "All Pages Functions are billed as Workers" | https://developers.cloudflare.com/workers/platform/pricing/ |
| **D1** | 5 M rows read and 100,000 rows written per day; 5 GB in total, **500 MB per database**; 7-day Time Travel | 25 B reads and 50 M writes/month included; 5 GB included, then USD 0.75/GB-month; 10 GB per database; 30-day Time Travel. **Rows of at most 2 MB** on both plans | https://developers.cloudflare.com/d1/platform/pricing/, https://developers.cloudflare.com/d1/platform/limits/ |
| Durable Objects (SQLite) | Available on Free: 100,000 requests/day, 13,000 GB-s/day, 5 GB | 1 M requests/month included, then USD 0.15/M; 400,000 GB-s included; storage USD 0.20/GB-month | https://developers.cloudflare.com/durable-objects/platform/pricing/ |
| KV | 100,000 reads and **1,000 writes per day** | 1 M writes/month included, then USD 5/M | https://developers.cloudflare.com/kv/platform/pricing/ |
| R2 | 10 GB-month, 1 M Class A, 10 M Class B, no egress charge | USD 0.015/GB-month, USD 4.50/M Class A. `put` supports `onlyIf.etagMatches` (compare-and-swap); writes are strongly consistent | https://developers.cloudflare.com/r2/pricing/, https://developers.cloudflare.com/r2/api/workers/workers-api-reference/ |

KV's 1,000 writes a day and its lack of compare-and-swap rule it out for sync. The planner is one versioned document
with a content `revision` and a replacement `generation` (`src/core/model.ts:238-245`), and saving it is already a
compare-and-swap (`model.ts:345-351`). A single D1 row per account, updated with a conditional `UPDATE … WHERE
version = ?`, is the same contract on the server. **End-to-end encryption is technically feasible**, because the
server never needs to read the plan for sync. The obstacles are product ones (OD-5).

### 1.5 Legal obligations

| # | Obligation | Source |
|---|---|---|
| R-L1 | Ley 1581/2012: processing needs the person's prior, informed authorization, obtained "por cualquier medio que pueda ser objeto de consulta posterior" (art. 9). Queries are answered within 10 business days (art. 14) and claims within 15 (art. 15). The controller keeps data secure against "adulteración, pérdida, consulta, uso o acceso no autorizado" (art. 17 d) and adopts an internal manual (art. 17 k). The person may revoke consent or ask for deletion (art. 8 e, conditionally upheld). Transfers to countries without an adequate level of protection are prohibited unless the person expressly consents (art. 26) | https://apps.procuraduria.gov.co/gd_1952/docs/l1581012.htm |
| R-L2 | Registration in the national database registry (RNBD) is required only for companies with total assets above 100,000 UVT (Decreto 090/2018). Secondary sources say it is still in force | https://www.asuntoslegales.com.co/analisis/catalina-herrera-von-norden-530696/cambios-en-el-registro-nacional-de-bases-de-datos-2596772; https://www2.deloitte.com/content/dam/Deloitte/co/Documents/legal/Registro-Nacional-de-Bases-de-Datos-2025.pdf |
| R-L3 | Storing data on Cloudflare servers outside Colombia makes Cloudflare a processor abroad. The contract that requires (Decreto 1377/2013, compiled in Decreto 1074/2015) and whether the US counts as adequate (SIC Circular 005/2017) **could not be read**: the government sites failed TLS | not verified, needs the lawyer (OD-6) |
| R-L4 | GDPR applies to controllers outside the EU that offer services to people in the Union "irrespective of whether a payment … is required" (Art. 3(2)(a)); mere accessibility is not enough (Recital 23). Erasure on withdrawn consent (Recital 65), portability in a "structured, commonly used, machine-readable" format (Recital 68), an answer "at the latest within one month" (Recital 59), an EU representative unless the processing is occasional (Recital 80) | https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng |
| R-L5 | Google's user-data policy: "Honor user requests to delete their data" | S1b R-P1 |

**Account deletion on the web.** Apple's in-app deletion rule (R-A8) does not apply to a web app. Ley 1581 (deletion
and revoked consent), GDPR (erasure, portability) and Google's policy do, so this design offers deletion and export
in the app anyway.

### 1.6 What changed in the last three months (2026-08-07 to 2026-11-07)

- **Apple:** the App Review Guidelines were updated on 2026-10-16. The listed changes (1.2, 2.3.14, 2.5.19, 3.1.1(a),
  5) do not touch login, Sign in with Apple, account deletion or the web (https://developer.apple.com/news/?id=92th7e5i).
  The iCloud "authorize with your Apple Account" page dates from 2025-10-07, outside this window.
- **Google:** the fetched pages carry no dates and show no change. We did not find a changelog for OAuth verification.
- **Cloudflare:** the D1 pricing page says "Last updated Oct 30, 2026" but does not say what changed. Durable Objects
  now retry failed calls automatically (changelog, 2026-11-05). SQLite storage billing for Durable Objects started in
  January 2026, outside this window.
- **Colombia / EU:** no change found. The RNBD threshold and Ley 1581's terms are as above.

## 2. Options

Assumptions, because there are no real numbers yet: every person is active daily, with 8 pulls and 6 pushes a day
(14 sync requests, plus about 8 Google token mints in premium). A push writes 2 rows (the current copy and the
previous one), and a compressed, encrypted plan takes about 50 KB (S0 measures this). **Cost excludes the Apple fee**
(USD 8.25 a month, OD-2), which applies to every option that offers Apple.

| | **A. Pages Functions + D1, one document row per account** (recommended) | B. A Durable Object per account (SQLite, WebSocket push) | C. A third-party backend (Supabase) |
|---|---|---|---|
| 100 people | USD 0 (2,200 requests and 1,200 writes a day) | USD 0 | USD 0 on Free, but "Free projects are paused after 1 week of inactivity" (https://supabase.com/pricing), so in practice Pro at USD 25 |
| 1,000 | USD 0 (22,000 requests and 12,000 writes a day; 100 MB) | USD 0 | USD 25 |
| 10,000 | **About USD 5** (220,000 requests a day exceeds Free, so Workers Paid; 6.6 M requests, 3.6 M writes and 1 GB fit within what is included) | About USD 6–7 (Workers Paid plus about 6 M DO requests) | USD 25 plus usage |
| Privacy | Same origin, the existing D1 database and processor (Cloudflare) | Same | A second processor and contract, and a second transfer abroad (R-L3) |
| Complexity | One table and four routes on code we already have | Instant updates, but a new runtime (classes, WebSockets, hibernation) and a Worker next to Pages | A new SDK, auth and row-level security, and a second deploy |
| Lock-in | Low: standard SQL, and the payload is our own export format | Medium: the Durable Object API | High: vendor auth and identifiers |

**Not an option:** KV (1,000 writes a day on Free, no compare-and-swap). R2 for the payload is a fallback only if S0
shows plans near D1's 2 MB row limit (§5).

## 3. Minimal recommended design (option A)

### 3.1 Identity

- **Account.** `accounts(account_id, created_at, consent_version, consent_at)` and
  `identities(provider IN ('google','apple'), sub, account_id, email, created_at)`, with `UNIQUE(provider, sub)`.
  The email is shown only so the person recognizes the account; it is **never used to link** (Apple relay addresses
  change, and Google says email is not an identifier, R-G1).
- **Sign-in flow.** It follows S1a's shape: `POST /api/auth/<provider>/start` (guarded like `http.ts:110-119`) writes
  a pending row keyed by `sha256(state)`, with the PKCE verifier and nonce, bound to the Strict device cookie. The
  provider's callback looks the pending row up **by state hash only**, because Apple's form_post is a cross-site POST
  that carries no Lax or Strict cookie (R-W1). It exchanges the code, checks `iss`, `aud`, `exp` and `nonce`, takes
  `sub`, then answers `303` to `GET /api/auth/finish?ticket=…`. That same-site request carries the Strict device
  cookie, which must match the pending row before a session is issued. Only `/api/auth/apple/callback` is exempt from
  the Origin guard.
- **Session.** A random 256-bit token in `__Host-wl_ses` (`HttpOnly; Secure; SameSite=Lax; Path=/`). D1 stores only
  `sha256(token)`, the account and the device hash; sessions expire after 180 idle days. Sign out deletes this
  session; "Sign out everywhere" deletes them all. **No provider token is kept**: Google sign-in asks for no refresh
  token, and Apple's are discarded after the exchange.
- **A second sign-in method.** A signed-in person can add the other provider (Settings › Account). If that identity
  already belongs to another account, it is refused with a message. Accounts are not merged in v1.
- **The existing per-device Google connection.** Signed-out devices keep S1b exactly as it is. When a device with a
  `google_credentials` row signs in, the row **moves to the account**: the store adds a nullable `account_id`, and a
  mint for a signed-in device reads the account's credential. If the account already has one, the account's
  credential wins and the device's row is deleted **without a revoke**, because a revoke is grant-wide and would kill
  the account's credential when both use the same Google account (R-G6). A grant left unused at Google expires there
  (S1b R-G1) or can be removed at myaccount.google.com. Connecting Google Calendar while signed in stores it on the
  account, so **you connect once and every signed-in device sees your calendar**.

### 3.2 Sync model for the local IndexedDB planner

- **The source of truth stays on the device.** The repository is unchanged: IndexedDB `next168` at schema v3
  (`src/repositories/storageVersion.ts:16`), with the same compare-and-swap. Sync is an adapter that runs after a
  commit, on open, on focus and when the connection returns. There is no background sync and no timer.
- **What is synced:** the planner document only, as the export bundle's document (`src/core/exportBundle.ts`). Not
  synced: proposals, the local Google state, preferences and **raw calendar texts** (each up to 5 MiB,
  `docs/calendars.md:27`). On another device, URL subscriptions refresh themselves; an imported file shows the
  existing "import the file again" message (`docs/calendars.md:31`).
- **Local sync state** sits in the existing `meta` store under a new key, `sync`: `{accountId, baseVersion,
  baseDocumentHash, dirty}`. **No IndexedDB version bump.** The last synced document is kept as the merge base under
  the `snapshots` store's new key `sync-base`.
- **Server state:** `plans(account_id PRIMARY KEY, version, key_id, iv, ciphertext BLOB, updated_at)` plus
  `plans_previous` (the version before it). Push is `PUT /api/sync {baseVersion, document}` →
  `UPDATE plans SET … , version = version + 1 WHERE account_id = ? AND version = ?`; zero rows changed means `409
  {version}`. Pull is `GET /api/sync` with `If-None-Match: <version>`.
- **Conflicts (409).** The client pulls, then does a **three-way merge by entity id** (categories, blocks, tasks,
  check-ins and events have ids) against `sync-base`. An entity changed on only one side takes that side. An entity
  changed on both sides takes **the server's version**, and the device's losing version goes to `snapshots`
  (`sync-conflict`) with one notice: "1 change from this device was replaced. Restore it". Settings merge per field
  the same way. The merged result is committed locally (through the normal compare-and-swap) and pushed again; after
  3 failed rounds, sync stops and says so.
- **Replacements.** A higher `generation` (delete-all, import, restore; `model.ts:242-244`) is pushed as a whole
  replacement. Other devices adopt it; any local unsynced edits go to `sync-conflict` first.
- **Offline.** Everything keeps working locally; `dirty` stays set and is pushed on the next chance. The only thing
  shown is "Not synced yet" in Settings › Account, never a modal.
- **Migrating a local plan into an account (first sign-in on a device).** If the server holds no plan, this device's
  plan is uploaded with its `workspaceId`. If the server holds a plan and this device's plan is empty, the server's
  plan is used. If both have content, the person chooses: **"Use my account's plan"** (this device's plan is first
  saved as a downloadable copy, the existing export) or **"Replace it with this device's plan"**. Two different
  workspaces are never merged.
- **Sign out** keeps the plan on the device (it is the person's), clears `sync` and stops syncing.

### 3.3 Server storage and security

- The same D1 database `weeklid` and the same Pages project. New tables: `accounts`, `identities`, `sessions`,
  `auth_pending`, `plans`, `plans_previous`, and the `account_id` column on `google_credentials`.
- The plan is gzip-compressed (`CompressionStream`), then sealed with AES-GCM under a new secret `SYNC_KEY` with a
  `key_id` (reusing `server/google/crypto.ts`). A leaked D1 export or console view does not reveal plans. Cloudflare
  code running with the secret still could: this is **not** end-to-end encryption (OD-5).
- Calendar events are never stored on the server (as in S1b). Logs record only the route, the outcome and the duration
  (as `logs.spec.ts`).
- Every route is off unless `ACCOUNTS_ENABLED=1`, and premium routes check that the account is on the beta allowlist
  (`beta_access(account_id)`). A build without the flag makes no `/api/auth` or `/api/sync` call (CI checks this, as it
  does for `api/google` today, S1b R-12).

### 3.4 Each person's calendars

- **Google, through the account:** connect once while signed in; every signed-in device mints from the account's
  credential (§3.1). With OD-4, the person picks calendars from their list. The picked ids sync as part of
  `document.calendarSources`; events are still read from Google on each device and never stored.
- **Apple:** only a **public iCloud calendar link**, fetched through a same-origin `GET /api/ics?url=` proxy for
  premium accounts. It ports the companion's rules (`docs/architecture/deliverable-1.md:24`: http/https only, size and
  time limits, no redirects to private IPs) and only allows iCloud's published-calendar hosts. The proxy stores and
  logs nothing about the content. The person is told plainly that "anyone with this link can see this calendar".
  Signing in with Apple adds no calendar access.

### 3.5 Account deletion and data export

- **Delete account** (Settings › Account, needs a fresh sign-in): in one D1 batch, it deletes the account, its
  identities, sessions, plans, beta access and Google credential; it then revokes the Google grant (as S1b does) and,
  for Apple, uses the fresh sign-in's tokens to call `/auth/revoke` (R-A5, R-A9). The device keeps its local plan
  unless the person also chooses "Delete all data". The person is told plainly that **Cloudflare's point-in-time
  recovery keeps restorable copies for up to 30 days** (7 on Free, §1.4), and the privacy policy says so too.
- **Apple notifications:** `consent-revoked` and `account-deleted` remove that identity; if it was the account's only
  identity, the account is deleted (R-A6).
- **Export:** "Download my account data" returns the server's plan as the existing export bundle plus a JSON record
  of the account (identities, dates, consent version). That covers portability (R-L4) and the Ley 1581 query (R-L1).

## 4. Slices (each keeps the free local tier unchanged)

Release order: S0 → S1 → S2 → S3 → (OD-3 verification) → S4 (after OD-2) → S5. Every slice ships dark behind
`ACCOUNTS_ENABLED` and the allowlist.

| Slice | Content | Executable acceptance |
|---|---|---|
| **S0** Size check | A fixture at the schema's maxima (`model.ts:246-252`, including 50,000 actuals) and a realistic one | A unit test prints the gzip size and **fails if the maximum exceeds 1.5 MB**. If it fails, the R2 fallback (§5) is designed before S1 |
| **S1** Google accounts (server) | D1 migration; start, callback, finish, session, sign out, delete, export; beta allowlist | Node tests over the real handlers with a fake Google: wrong state, nonce or `aud` → no session; a callback without the device cookie → no session; a session cookie is `__Host-`, HttpOnly, with only its hash in D1; delete leaves zero rows for the account in every table; with the flag off, every route answers 404. **Free-tier guard:** the existing e2e suite passes with the flag off, and a test asserts that a signed-out page load makes no `/api/auth` or `/api/sync` request. **Owner canary:** a sign-in with an account that is not a test user, in Testing (checks R-G2's exception) |
| **S2** Sync client | Settings › Account, migration choice, push and pull, merge, offline | e2e with two browser contexts and a fake server: an edit on A appears on B after B gets focus; concurrent edits to different tasks are both kept; the same task edited on both → the server's version wins, and `sync-conflict` holds the other with a Restore that works; offline edits push when the connection returns; first sign-in with local content plus server content shows the choice and loses nothing; `STORAGE_VERSION` is still 3 |
| **S3** Google Calendar per account | `account_id` on credentials, adoption on sign-in, calendar list (OD-4) | Node: a device credential is adopted; if the account already has one, the device's row is deleted and **no revoke is sent**; a second signed-in device mints without connecting. e2e: signed-out devices behave exactly like S1b (the A-1…A-19 suite still passes) |
| **S4** Sign in with Apple | Services ID, return URL, client secret, form_post callback, notifications, linking | Node: a cross-site POST callback with no cookies completes only through `/finish` with the matching device cookie; notification JWS with a bad signature → ignored; `account-deleted` → account gone. **Owner canary** on a real iPhone, in Safari and in the installed app (S1b R-A1) |
| **S5** iCloud public link | `/api/ics` proxy, premium only | Node: a non-iCloud host, a private IP, a redirect, more than 5 MiB, or more than 10 s → refused; a signed-out request → 401; no body is logged |

## 5. Rejected alternatives and over-engineering removed

- **CRDTs (Automerge, Yjs):** they would change the stored format and the v3 fence for a single-person planner; a
  merge by entity id covers the real case.
- **Realtime WebSockets (option B) in v1:** refreshing on focus is enough for one person moving between devices.
  Revisit if people report stale views.
- **Normalizing the plan into SQL tables:** the plan already has a whole-document compare-and-swap contract; one row
  per account mirrors it.
- **R2 for the payload:** a second store with no benefit while plans fit in 2 MB. It becomes the fallback if S0 fails.
- **Syncing raw calendar texts:** up to 5 MiB each; subscriptions refresh themselves.
- **CalDAV with app-specific passwords:** a broad, long-lived iCloud credential held on our server.
- **Linking accounts by email**, account merging, and storing Apple or Google sign-in refresh tokens.
- **Email magic links and passkeys:** they need email sending (R-A7) or a new flow; the owner asked for Apple and Google.
- **A third-party backend (Supabase):** USD 25 a month, plus a second processor and lock-in (§2).
- **End-to-end encryption in v1** (OD-5); keeping more than one previous version; background sync and timers.

## 6. What the red team should attack

1. **The Apple form_post callback:** can a cross-site POST, or a stolen `state`, create a session on the attacker's
   device or the victim's? Is the `/finish` ticket single-use, short-lived and bound to the device?
2. **Identity collisions:** linking an Apple identity that already belongs to another account; an Apple `sub` reused
   across Services IDs; relying on Apple's email when it arrives only on the first sign-in.
3. **Adopting the device credential:** the "delete without revoke" rule leaves an unused grant at Google. Is that
   acceptable under Google's policy (R-L5)? Can an adoption race with S1b's Disconnect, so a credential survives a
   Disconnect?
4. **The three-way merge:** a deleted entity on one side and edited on the other; check-ins whose ids collide; a
   replacement (`generation`) racing an ordinary push; a lost `sync-base` (a cleared `snapshots` store after Delete all
   data) treated as "everything changed".
5. **The free-tier guarantee:** any code path on a signed-out or flag-off build that calls `/api/auth`, `/api/sync`
   or `/api/ics`, or that writes the `sync` meta key.
6. **Deletion that lies:** Time Travel copies, `plans_previous`, a pending auth row, sessions on other devices still
   accepted after deletion, an Apple revoke that fails silently.
7. **Google's basic-scope exception (R-G2)** possibly not holding for a project that also lists a sensitive scope, which
   would cap sign-ins at 100 test users.
8. **iOS installed apps:** separate cookie jars (S1b R-A1) mean a sign-in done in Safari does not carry over into the
   home-screen app. Does the form_post round trip leave the installed app?
9. **The `/api/ics` proxy as an SSRF or open relay,** and DNS rebinding past the iCloud host allowlist.
10. **Legal gaps (R-L3):** the processor contract and the transfer abroad without a lawyer's reading; GDPR exposure
    from the de/fr locales.
