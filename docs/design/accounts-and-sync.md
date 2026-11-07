# Accounts and plan sync across devices (v1)

Status: **proposed, revision 5**; risk tier critical (auth, personal data, deletion). Revision 1: `9190e83`, rejected
by Codex in round 1; revision 2: `4924abb`, accepted with changes in round 2; revision 3: `99d4e61`, rejected in round 3; revision 4: `56f09b2`, accepted with changes in round 4. This revision is against `main` f77ebc0. External pages were read on 2026-11-07 (UTC); no Google,
Apple or Cloudflare production endpoint was called and no secret was read.

**Goal (v1).** A person signs in with Google and sees the same plan on every device where they are signed in.
Nobody has to sign in: without an account, Weeklid behaves exactly as it does today.

## Red-team round 1 resolution

**Coordinator direction (2026-11-07), owner may veto:** v1 is Google sign-in plus plan sync only; Apple, iCloud and the
per-account calendar credential wait for beta evidence. As in S1b, machinery is removed rather than fenced.

| # | Finding (family) | Resolution | Where |
|---|---|---|---|
| 1 | BLOCKER: after A signs out and B signs in, A's plan uploads to B (*data crossing accounts*) | **Resolved.** The local plan stays **bound to the account that synced it**, also after sign-out. With a different account, the plan is never uploaded: the person removes it from this device or cancels the sign-in. An unbound plan is uploaded only after an explicit confirmation. Family check: an import or restore while signed out clears the binding in the same transaction, so a file plan can't inherit A's binding; tests A→B, shared device, import-then-sign-in | §2.2, S2 |
| 2 | BLOCKER: the local `generation` can't order delete-all across devices (*client-chosen order*) | **Resolved.** The server owns `revision` (compare-and-swap) and a **replacement `epoch`**. Delete-all, import and restore raise the epoch, and a write based on an older epoch gets `409 replaced`. The local `generation` and `updatedAt` decide nothing in sync. Family check: no client clock or counter orders anything | §2.3 |
| 3 | MAJOR: the merge assumes ids that check-ins and actuals lack (*incomplete keys*) | **Resolved.** One stable key per collection, one rule for both edits and deletes, and a fallback when the merged plan fails validation. Family check: every field of `plannerDocumentSchema` (`src/core/model.ts:238-260`) is listed, including the two applied-id sets | §2.3 table |
| 4 | MAJOR: after sign-out, the plan stays visible on a shared device (*leftover local data*) | **Resolved.** Sign-out asks whether to remove this account's data from the device. "Remove" reuses the device part of Delete all data, which also forgets this device's Google Calendar permission (S1b). "Keep" says plainly who can still see it | §2.2, S2 |
| 5 | MAJOR: the finish ticket has no expiry or single use; linking isn't bound (*replay and binding*) | **Cut.** With Apple out, the callback is Google's top-level GET, which carries a Lax cookie, so the S1a pattern works and there is **no finish ticket**. The pending row is bound to the flow cookie and consumed atomically. There is only one provider, so there's **no linking** in v1. Family check: replay, a missing or foreign flow cookie, an expired row, and a session cookie that isn't regenerated | §2.1, S1 |
| 6 | MAJOR: no safe D1 upgrade (`CREATE TABLE IF NOT EXISTS` can't add a column) (*schema evolution*) | **Resolved.** v1 **adds only new tables** and alters no S1b table (S3 is out). A versioned migration file, applied before the flag is on; old workers never read the new tables; rollback = flag off, then an ordered purge. Tested against the current S1b schema with rows in it | §2.4, S1 |
| 7 | MAJOR: moving the credential can race Disconnect and strand a grant (*ownership change*) | **Out of v1** (S3 removed): each device keeps its own S1b calendar connection, unchanged. No credential changes owner | §3 |
| 8 | MAJOR: a point-in-time restore can bring a deleted account back (*restore resurrects*) | **Superseded by round 3:** account data is never restored | §2.5 |
| 9 | MAJOR: the iCloud proxy has CSRF, URL-exposure and abuse gaps (*proxy surface*) | **Out of v1** (S5 removed). Recorded requirements for later: a guarded POST, the URL redacted from logs, per-account limits, strict host, redirect and egress checks | §3 |
| 10 | MINOR: guard matrix, Supabase, cost labels, GDPR wording | **Resolved.** The guard matrix covers both flag states, signed in and out, requests and the `sync` key. The Supabase row is corrected, costs are labelled *modeled*, and GDPR is stated as a precaution pending legal review | S1, §1.3, §0 |
| S0 | Measure the real maximum sealed payload | **Resolved.** S0 measures the worst-case serialized, compressed, sealed bytes against D1's 2 MB row limit, and checks a bound BLOB above 100 KB on a preview database | S0 |
| — | Over-engineering to cut | `plans_previous`, the R2 fallback, Apple, iCloud and credential adoption are removed. Merge conflicts keep one local copy only | §4 |

## Red-team round 2 resolution (Codex, ACCEPT WITH CHANGES on `4924abb`)

| # | Finding | Resolution |
|---|---|---|
| 1, 3, 4, 5 | Binding across tabs; restore fence; Remove and other tabs; retry bursts | **Superseded by round 3** (a single lock hold per attempt; no restore; no dirty mark) |
| 2 | One conflict copy can overwrite unsynced work | **Resolved by pausing**, the simpler option: while a `sync-conflict` copy exists, sync pauses until the person chooses. Keeping several copies would need a cap, a list, and the same pause once the cap is reached (§2.3) |
| 6 | Minors | **Resolved:** server request bounds before parsing (S0); an explicit login-CSRF test (S1); the beta allowlist is intentional (§2.4) |

## Red-team round 3 resolution: simplification (Codex REJECT on `99d4e61`)

**Coordinator direction (2026-11-07), owner may veto:** the device is the source of truth and the server only a relay and
copy. All three MAJORs were in round-2 machinery, so it is removed, not fenced (supersedes round 1 #8, round 2 #1, #3–#5).

| # | Finding (family) | Resolution | Mechanism removed | Where |
|---|---|---|---|---|
| N1 | A pull's write is not fenced by the binding (*a check outside the write*) | **Resolved.** An attempt is one hold of the commit lock: read, one request (now a 10 s budget, R4-1), then a commit that re-checks `sync` and `purgeEpoch` **in the same transaction** as the document write. Every writer of `sync` holds the same lock | `saveAtEpoch` as the pull fence | §2.3 |
| N2 | The restore cannot prove the routes are closed on every worker (*an unverifiable fence*) | **Cut.** Account data is never restored from Time Travel. If the server copy is lost, devices re-upload (`noPlan` → a create; conflicts pause). Nothing restored means nothing resurrected | the 9-step restore, the route fence, the deletion ledger | §2.5 |
| N3 | The dirty mark and backoff between tabs (*shared mutable flags*) | **Cut.** No dirty mark: every attempt re-reads the document and compares its hash with `baseHash`. No second lock. Backoff is per tab; one attempt per trigger, serialized by the lock, so a burst is bounded and duplicates are harmless | `dirty`, `weeklid-sync`, cross-tab backoff | §2.3 |
| R2-4 | Remove must clear `sync` atomically; a push in flight (*partial removal*) | **Resolved.** `sync: null` goes in the delete-all transaction itself. Remove waits for the running attempt. A push that already left may land at the server, which is harmless: it is the person's own account | — | §2.2 |
| R2-7 | Research date (INFO) | **Kept:** 2026-11-07 is the UTC date of the reads; the reviewer's environment showed the local date, 2026-11-06 | — | header |

## Red-team round 4 resolution (Codex, ACCEPT WITH CHANGES on `56f09b2`)

| # | Finding | Resolution | Where |
|---|---|---|---|
| R4-1 | MAJOR: the lock hold isn't really bounded | **Resolved.** One `AbortController` with a 10 s budget covers the request, its body and the `409` follow-up, so the task always settles and the lock is released. On expiry, saves proceed and "Couldn't sync. Retry" appears. Hung-server tests | §2.3, S2 |
| R4-2 | MAJOR: a deleted account or a lost copy is silently resurrected | **Resolved (coordinator direction):** a tombstone of the hashed key gives `410 accountDeleted` (Remove or Keep local only, never a re-upload); `noPlan` after a previous sync asks before re-uploading. What a lost database loses is stated. Tests for both | §2.3, §2.5, S1, S2, OD-9 |
| R4-3 | MINOR: 304 is unspecified | **Resolved.** The ETag is `"<epoch>.<revision>"`; a `304` writes nothing; `noPlan` is a `404`, never a `304`. S2 test | §2.3, S1, S2 |

## 0. Owner decisions

| # | Decision | Recommendation | Why |
|---|---|---|---|
| OD-1 | Does this change the 2026-10-25 decision (free = local only; accounts plus sync = premium)? | **No.** Sync is premium. The free tier has no sign-in and makes no new server call. Until payments exist, premium runs as a free, **invite-only beta of at most 100 people** (`beta_access` allowlist). | Sync is the only feature with a recurring server cost. Stated plainly: since 2026-10-27 the free tier already has one small server dependency, S1b's per-device Google permission. This design adds no other. |
| OD-2 | Spending: Apple Developer Program, USD 99 a year (R-A1). | **Defer; no spending now.** Reconsider after beta evidence (for example, invited people who decline because there is no Apple option). | Apple sign-in gives no access to iCloud Calendar (R-A2), so its only value is a second way to sign in. |
| OD-3 | Google verification. | **Not needed for v1:** sign-in asks only for `openid email profile`, which is exempt from the test-user list, the warning and the 7-day expiry (R-G1). Calendar verification stays where it is today (S1b OD-S1b-1). | That keeps v1 independent of Google's review queue. |
| OD-4 | Who controls the data, and the lawyer. | Crexative S.A.S. as *Responsable*. Publish a *Política de Tratamiento*, collect consent at sign-up (R-L1), and treat GDPR **as a precaution pending legal review** (R-L3). A lawyer reviews both before the beta opens. **That review is spending and needs your approval.** | Ley 1581 requires prior, informed consent and a written policy. The rules for processors abroad could not be read (R-L2). |
| OD-5 | End-to-end encryption. | **No in v1.** The plan is sealed with a server key (§2.4), and the payload format is versioned. | A lost key would mean a lost plan, and it would prevent the approved remote MCP "proposal inbox" from reading the plan. |
| OD-6 | Delete all data while signed in. | It **empties the account's plan on every device** (a new epoch), then wipes this device and signs out. The confirmation says so. | Otherwise the next sync would bring the deleted plan back. |
| OD-7 | Price and payment provider (blocks charging, not building). | Decide after the beta. Comparable planners charge about USD 2.8–4.2 a month or USD 29.99 a year (`docs/research/competitors-commercial.md:29`, `:32`). | Modeled infrastructure cost is about USD 5 a month at 10,000 people (§1.3). It does not drive the price. |
| OD-8 | Account data is never restored from Time Travel (coordinator direction). | **Accept.** If the database is lost, people sign in again, devices re-upload, and Google Calendar connections (S1b) must be redone. | A restore cannot be fenced provably; the devices already hold the plan. |
| OD-9 | A deleted account's Google identity cannot sign up again (a permanent tombstone, coordinator direction). | **Accept for v1**, and have the lawyer confirm that keeping one hash per deleted account is allowed (OD-4). Revisit if people ask to start over. | It is the only way to stop an offline device from silently re-creating a deleted account. |

## 1. Dated research (read 2026-11-07)

### 1.1 Google sign-in on the existing client and server

| # | Finding | Source |
|---|---|---|
| R-G1 | In Testing, "apps that request only the basic name, email and profile scopes" skip the test-user list, the warning and the 7-day expiry; asking for any other scope removes the exception (Codex round 1 confirmed this). Unverified production apps have a lifetime cap of 100 users for sensitive scopes | https://support.google.com/cloud/answer/15549945 |
| R-G2 | "Use `sub` … as the unique-identifier key"; email "may not be unique". An ID token received directly from the token endpoint over HTTPS "really comes from Google" | https://developers.google.com/identity/openid-connect/openid-connect |
| R-G3 | Brand verification (home page, privacy policy) applies to every app; the extra review steps are for sensitive and restricted scopes only | https://support.google.com/cloud/answer/13464321 |

**Repo:** S1a already runs the code flow with PKCE and a secret (`server/google/googleOAuth.ts:14-34`, `:87-110`). It
stores pending rows by state hash (`connectionStore.ts:113`), uses the Lax flow cookie `__Host-wl_gflow` and the Strict
`__Host-wl_dev` (S1b R-1; `handlers.ts:22-24`), the POST guards (`http.ts:110-119`) and AES-GCM sealing (`crypto.ts`,
`config.ts:54-57`). Sign-in reuses the client (plus one redirect URI) and these modules, with its own route and scope.
**Owner canary (S1):** a non-test user signs in while the consent screen lists the calendar scope (confirms R-G1).

### 1.2 Apple and iCloud (later, not v1)

| # | Finding | Source |
|---|---|---|
| R-A1 | Web sign-in needs a Services ID tied to a primary App ID (no domain file), in a program that costs USD 99 a year | https://developer.apple.com/help/account/capabilities/configure-sign-in-with-apple-for-the-web/, https://developer.apple.com/programs/whats-included/ |
| R-A2 | Apple sign-in returns `sub` and, on the first sign-in only, a name and an email (possibly a relay address that needs SPF-registered senders); there is **no calendar access**. For iCloud, the options are a public calendar link (readable by anyone with it, no CORS, so it needs a proxy), file import (free today), CalDAV with an app-specific password (it unlocks mail, contacts and calendars: rejected), or "authorize with your Apple Account" (supported apps only; no developer API found) | https://developer.apple.com/help/account/capabilities/configure-private-email-relay-service/, https://support.apple.com/en-us/102654, https://support.apple.com/en-us/121539 |
| R-A3 | App Review 4.8 and 5.1.1(v) (in-app account deletion) bind App Store and notarized apps, not a web PWA | https://developer.apple.com/app-store/review/guidelines/ (updated 2026-10-16) |

### 1.3 Storage on Cloudflare, and options (costs are **modeled**, not measured)

D1 Free: 5 M rows read and 100,000 written a day, 500 MB per database, rows of at most 2 MB, SQL statements of at
most 100 KB, 7-day Time Travel. Workers Paid (USD 5 minimum): 25 B reads and 50 M writes a month, 10 GB per
database, 30-day Time Travel (https://developers.cloudflare.com/d1/platform/pricing/,
https://developers.cloudflare.com/d1/platform/limits/). Workers Free: 100,000 requests a day; Paid: 10 M a month
included, and Pages Functions are billed as Workers (https://developers.cloudflare.com/workers/platform/pricing/).
KV allows 1,000 writes a day on Free and has no compare-and-swap, so it is ruled out
(https://developers.cloudflare.com/kv/platform/pricing/).

The workload model: everyone active daily, 8 pulls and 6 pushes a day, one row written per push plus the index writes
Cloudflare also counts, about 50 KB per sealed plan (S0 replaces this with a measurement), no abusive traffic.

| | **A. Pages Functions + D1, one row per account** (recommended) | B. A Durable Object per account | C. Supabase |
|---|---|---|---|
| 100 / 1,000 / 10,000 people | USD 0 / 0 / about 5 (above 100,000 requests a day → Workers Paid) | 0 / 0 / about 6–7 | 0 / 0 on Free (50,000 MAU, 500 MB); about 25 at 10,000 (500 MB is full). Free projects pause "after 1 week of inactivity", which is a risk for a quiet beta (https://supabase.com/pricing) |
| Privacy, complexity, lock-in | Existing processor and database; a few routes on S1a code; low lock-in | Same processor; a new runtime; medium | A second processor and transfer abroad; a new SDK and auth; high |

### 1.4 Legal

| # | Obligation | Source |
|---|---|---|
| R-L1 | Ley 1581/2012: prior, informed authorization "que pueda ser objeto de consulta posterior" (art. 9); queries answered within 10 business days (art. 14), claims within 15 (art. 15); security (art. 17 d); an internal manual (art. 17 k); revoking consent or deletion (art. 8 e); transfers to countries without adequate protection only with express consent (art. 26). The national database registry applies only above 100,000 UVT in assets (Decreto 090/2018, secondary sources) | https://apps.procuraduria.gov.co/gd_1952/docs/l1581012.htm |
| R-L2 | Processor contracts and adequacy (Decreto 1377/2013, SIC Circular 005/2017) are **not verified**: the government sites failed TLS | the lawyer (OD-4) |
| R-L3 | GDPR reaches controllers that *offer* services to people in the EU (Art. 3(2)(a)); mere accessibility, or a language alone, is not enough (Recital 23). Erasure, portability, an answer within one month | https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng |

**In the last three months:** Apple updated its guidelines on 2026-10-16 with nothing on login, deletion or the web;
the D1 pricing page says "updated Oct 30, 2026" but lists no change; Durable Objects added automatic retries on
2026-11-05. We found no change from Google or in Colombian or EU law.

## 2. Minimal design (option A)

### 2.1 Identity: Google only

- Tables: `accounts(account_id, created_at, consent_version, consent_at)` and `identities(sub PRIMARY KEY,
  account_id, email)`. Email is shown only so the person can recognize the account and is never used as a key (R-G2).
  The name from `profile` is not stored.
- `POST /api/auth/start` (S1a guards) sets a Lax `__Host-wl_aflow` cookie and writes `auth_pending(state_hash,
  flow_hash, verifier, nonce, created_at)` (600 s). `GET /api/auth/callback` **deletes the row by state hash and flow
  hash in one statement** (`DELETE … RETURNING`). No row means a replay, a foreign or missing flow cookie, or expiry,
  and no session is created. It then exchanges the code, checks `iss`, `aud`, `exp` and `nonce`, finds or creates the
  account by `sub`, and answers `303` with a **new** session cookie.
- Session: a random 256-bit token in `__Host-wl_ses` (`HttpOnly; Secure; SameSite=Lax; Path=/`); D1 stores only
  `sha256(token)`; 180 idle days. Sign out deletes that row. No Google token is stored.

### 2.2 The binding between account and device

The meta key `sync` (existing `meta` store, **no IndexedDB version bump**, `storageVersion.ts:16`) holds `{accountKey,
epoch, baseRevision, baseHash}`. `accountKey` = server-computed `sha256(sub)`, so it survives a lost server copy (§2.5).
It stays after sign-out (the plan stays **bound**) and is written only inside the commit lock (`storageCommit.ts:27-33`),
in the same transaction as the document. Without Web Locks commits are refused (`BrowserPlannerRepository.ts:349`).

| On sign-in with account X | Result |
|---|---|
| The plan is bound to X | Normal sync |
| The plan is bound to another account | **Never uploaded.** "This device holds another account's plan": **Remove it from this device and continue** or **Cancel** (the plan stays local, X's session is deleted) |
| The plan is unbound and empty | Claim the binding, then pull |
| The plan is unbound and has content; X has no plan | "Save this device's plan to your account?" Yes claims the binding and uploads; No cancels |
| The plan is unbound and has content; X has a plan | **Use my account's plan** (this device's plan downloads first as the existing export) or **Replace my account's plan with this one** (a new epoch) |

The choice comes *before* any claim; the claim writes `sync` only if it still holds what the dialog showed, else it
asks again. Cancel claims nothing. **Sign-out** asks: **Remove this account's data from this device** (recommended on a shared device) or **Keep it**.
The copy for "Keep it": "Anyone who uses this browser can still see this plan and this device's Google events. It
stays linked to your account and will not be added to another one."

**Remove** = the device part of Delete all data (which also forgets this device's Google Calendar permission), with
`sync: null` in its single transaction (`BrowserPlannerRepository.ts:218-221`, `indexedDbStore.ts:95`). It waits for a
running attempt (≤ one timeout); a push already sent may still land, harmlessly, in the person's own account. Import or
restore while signed out also clears `sync` in its transaction.

### 2.3 Sync: one attempt is one hold of the commit lock

Each attempt runs entirely inside one hold of the existing exclusive lock (`webLockRunner`):

1. Read `sync`, `purgeEpoch`, the document and `sync-base`; stop if the binding does not match the session's
   `accountKey`, if a `sync-conflict` copy exists, or if the device is offline.
2. Network, under **one** `AbortController` with a **10 s total budget** that covers the request, reading its body and
   the follow-up push after a `409`. Abort makes every `fetch` and body read reject, so the task always settles and
   `webLockRunner` releases. If the document's hash differs from `baseHash`,
   push `PUT /api/sync {accountKey, baseRevision, epoch, document}` (`UPDATE … WHERE revision = ? AND epoch = ?`; a
   `409` carries the server's plan); otherwise pull with `GET` and `If-None-Match: "<epoch>.<revision>"`
   (the server's ETag). **`304`** writes nothing: the document, `sync` and `sync-base` stay as they are, and the next
   push uses them unchanged. **Replace** (Delete all data while
   signed in, import, restore, "replace my account's plan") is `PUT /api/sync/replace` and raises `epoch`. The server
   answers `409 accountMismatch` for another account's cookie, `410 accountDeleted` for a tombstoned `accountKey`
   (§2.5), and `404 noPlan` when it holds no copy. `noPlan` is never a `304`. A device that has never synced
   (`baseRevision = 0`) creates the copy after the existing confirmation. A device that has synced before **pauses**
   and asks: "Your account copy is missing. Restore it from this device?" Only Yes uploads.
3. Commit in **one strict transaction** that re-checks `sync` and `purgeEpoch` and writes the document, `sync` and
   `sync-base` together. A same-epoch `409` is merged (below), committed, then pushed once within the same budget. A `409
   replaced` adopts the server's plan, with this device's unsynced changes in `sync-conflict`, so a device that was
   offline for weeks cannot bring back a deleted plan.

A local save during an attempt waits **at most 10 s plus local work**, the price of this simplicity. When the budget
expires, the save proceeds right after, and Settings › Account shows "Couldn't sync. Retry". **No dirty mark:** every
attempt re-reads the document. **Triggers:** open, focus, 2 s after a save (debounced), "Sync now". Backoff is per tab
(1 s × 2ⁿ ± 50 %, ≤ 5 min, reset on success). **A burst is bounded:** one attempt per trigger per tab, serialized by the
lock; after one tab pushes, the others' hash equals `baseHash`, so they only send a conditional GET (`304`).
**Conflict copy:** while `sync-conflict` exists, sync pauses until the person chooses Restore, "Keep the synced plan"
or Download ("Sync is paused until you choose what to do with the change that was replaced"). It is never overwritten.

**Merge rule (the same for edits and deletes):** for each key, a side that differs from the base wins; if both sides
differ, **the server wins**, and the device's version goes to `sync-conflict`. If the merged plan fails
`validateDocument` (overlaps, references), the server's plan wins whole, and this device's plan goes to
`sync-conflict`.

| Field | Stable key |
|---|---|
| `categories`, `blocks`, `tasks`, `events`, `calendarSources` | `id` |
| `checkIns` | `date` (`model.ts:70-78`) |
| `actuals` | `(blockId, plannedStartAt)` (`model.ts:80-84`) |
| `settings` | each top-level field |
| `appliedProposalIds`, `appliedCaptureIds` | union, then trim to 200 keeping the server's order first |
| `workspaceId`, `schemaVersion` | must be equal, or it is treated as a replacement |
| `revision`, `generation`, `updatedAt` | local only; never compared in sync |

**Not synced:** raw calendar texts (up to 5 MiB each, `docs/calendars.md:27`; on another device, subscriptions refresh
and imported files show the existing "import again" message), proposals, preferences and S1b state.

### 2.4 Server storage and migration

- The plan is gzip-compressed, then sealed with AES-GCM under a new `SYNC_KEY` (reusing `crypto.ts`). That protects
  against a leaked export or console view; it is not end-to-end encryption (OD-5). Logs record only the route, the
  outcome and the duration.
- **Migration:** `server/accounts/migrations/0001_accounts.sql` creates only **new** tables (`accounts`, `identities`,
  `sessions`, `auth_pending`, `plans`, `beta_access`, `deleted_accounts`) and a `schema_migrations(version)` row. It never touches
  `google_pending` or `google_credentials` (`connectionStore.ts:88-109`). The owner applies it before setting
  `ACCOUNTS_ENABLED=1`; the routes answer `503 notConfigured` if version 1 is missing, and old workers never read these
  tables. **Rollback:** flag off (routes give 404), then `server/accounts/purge.sql` (sessions, then pending rows, then
  everything else), and the owner deletes `SYNC_KEY`.
- **The beta allowlist is intentional:** it caps the free beta at OD-1's 100 people until payments exist.

### 2.5 Deletion, export and the server copy

- **The device is the source of truth; the server is a relay and a copy.** Account data is **never restored from Time
  Travel** (stated in `DEPLOYMENT.md`). If the copy is lost, the database is recreated empty and people sign in again
  (same `accountKey`). A device that had synced re-uploads **only after the person confirms** (§2.3). Nothing is restored
  silently.
- **Delete account** (Settings › Account): one batch deletes the account, its identity, sessions, plan and beta
  access, and inserts a permanent tombstone `deleted_accounts(account_key)`: only the hash, no personal data. Any
  later sync or sign-in for that key gets `410 accountDeleted`. The device then offers **Remove from this device** or
  **Keep it on this device only** (`sync` cleared), and never offers a re-upload. A request already in flight at
  deletion may still land; the same batch removes it.
- **What a lost database loses:** the tombstones live in the same D1 database, so they survive a re-created database
  only if they are kept apart from it. v1 keeps them in D1, which is the simplest option. If the database *and* its
  tombstones are lost, an offline device of a deleted account could re-create the account copy, but only after the
  explicit "Restore it from this device?". That is the person's own choice.
- **Privacy copy:** "Your plan lives on your devices; Weeklid's server keeps an encrypted copy to pass it between them,
  deleted with your account. Cloudflare's recovery copies expire within 30 days, and Weeklid never restores from them."
- **Export:** "Download my account data" = the server plan as the existing export bundle plus the account record
  (portability, R-L3; a query under R-L1).

## 3. Later, after beta evidence (not v1)

Apple sign-in (OD-2; a single-use, hash-stored, device-bound ticket and account-bound linking); iCloud links (a guarded
POST proxy, URL redaction, limits, strict egress); a per-account calendar credential; realtime push; end-to-end encryption.

## 4. Slices (the free tier stays unchanged)

| Slice | Executable acceptance |
|---|---|
| **S0** Size | A unit test builds a plan at the schema maxima (`model.ts:246-252`) and a realistic one, serializes, gzips and seals them, and **fails if the maximum exceeds 1.9 MB**. **Server bounds:** `/api/sync` rejects a declared or streamed body above 2 MB with `413` before reading it in full, and anything that is not a valid `plannerDocumentSchema` with `400` before compressing or sealing. A preview-D1 canary (owner, no production) binds a BLOB above 100 KB. If the maximum fails, v1 refuses to push ("plan too large to sync") and nothing else is built |
| **S1** Server | Node tests over the real handlers with a fake Google: callback replay, a missing or foreign flow cookie, or an expired row → no session; **login CSRF:** the attacker's own `state` and code delivered to a victim browser, with the victim's flow cookie or none → no session, and the victim is not signed in as the attacker; bad `iss`, `aud` or `nonce` → no session; a new session cookie on every sign-in, with only its hash stored; another account's `accountKey` → `409 accountMismatch`; a `409` carries the server's plan; an empty account → `noPlan`, then a create; deleting leaves zero rows in every account table except the tombstone, which holds only the hash, and a later sync or sign-in for that key → `410 accountDeleted`; `noPlan` is a `404`, never a `304`; the ETag is `"<epoch>.<revision>"`. **Migration:** applied to a database built from today's S1b `SCHEMA` with rows in it, the S1b specs still pass, a second run is a no-op, and purge restores the S1b-only state. **Free-tier guard matrix:** {flag off, flag on} × {signed out}: no request to `/api/auth` or `/api/sync`, and no `sync` meta key; the existing e2e suite passes with the flag off; with the flag on and the person signed out, the same holds after edits, import and Delete all data. **Owner canary:** the R-G1 check |
| **S2** Client | e2e with two browser contexts and a fake server: an edit on A appears on B when B gets focus; concurrent edits to different keys of **every** collection in §2.3 are all kept; the same key changed on both devices (an edit or a delete) → the server wins and Restore brings back the device's version; a merge that would create overlapping blocks → the server's plan wins whole, with Restore; an offline push after a delete-all elsewhere gets `replaced`, nothing deleted comes back, and the local edits sit in `sync-conflict`; a second conflict while a copy exists → sync stays paused and the first copy is unchanged. **Binding:** A → sign-out (Keep) → B: nothing of A's reaches B's account, and the device asks to remove or cancel; a shared device, where A signs out with Remove → no plan, `sync` key or Google permission of A's remains; import while signed out → unbound; two tabs sign in as A and B at once → at most one claim succeeds and nothing is uploaded to the other account; Cancel while another tab's attempt holds a response → nothing is applied and `sync` stays absent. **One hold:** with a held pull response in tab 1, tab 2's Remove waits, then leaves nothing behind; a local save made during an attempt commits after it, and the next attempt pushes it; three tabs focused at once → their requests never overlap, and the later ones are `304`. **Hung server:** the fake server never answers → a local save made during the attempt completes within 10 s plus a margin, the lock is released, and "Couldn't sync. Retry" appears; the same with a hang during the follow-up push after a `409`. **304:** the document, `sync` and `sync-base` are byte-identical before and after, and the next push succeeds from that base. **Lost copy:** an emptied fake server → a device that has synced before asks before re-uploading (No uploads nothing), and a never-synced device keeps the first-upload confirmation. **Deleted account:** an offline device returns after deletion → `accountDeleted`, it offers Remove or Keep local only, and no request ever uploads. `STORAGE_VERSION` is still 3 |

## 5. Rejected and removed

CRDTs (they change the stored format for a single-person plan); realtime WebSockets; a plan normalized into SQL tables;
R2 and `plans_previous`; **restoring account data from Time Travel, the deletion ledger and the restore fence** (round 3);
**a dirty mark, a second lock and cross-tab backoff** (round 3); linking accounts by email; storing Google tokens for
sign-in; KV; Supabase (§1.3); CalDAV app passwords; and everything in §3.

## 6. What the red team should attack (round 4)

1. Writes to `sync` or the document outside the lock, or a commit that skips the in-transaction re-check.
2. The 10 s budget: anything that runs outside the `AbortController`; a tombstone bypass through a new sign-in.
3. Server loss: a stale device that re-creates first and brings back deleted content.
4. The pause and the merge: leaving `sync-conflict` with no choice; delete versus edit; trimming the applied-id sets.
5. The free-tier guard: any flag-off path that loads account code or writes `sync`.

## 7. Implementation status: S0 and S1 (server), off by default

Owner decisions of 2026-11-07 applied: an invite-only beta of at most 100 people, OD-8 (never restore account data), OD-9
(a deleted Google ID cannot sign up again), Crexative S.A.S. as controller. The owner's steps to switch it on are in
`DEPLOYMENT.md` ("Functions (accounts and sync, off by default)").

| Slice | Where | Tests |
|---|---|---|
| S0 bounds | `server/accounts/planCodec.ts` (2,000,000-byte body bound read as a stream, `plannerDocumentSchema` validation before gzip and sealing, 1,900,000-byte sealed cap, also a `CHECK` on `plans.payload`) | `server/accounts/size.spec.ts` |
| S1 server | `server/accounts/**`, `functions/api/auth/*`, `functions/api/sync/*`; migration `server/accounts/migrations/0001_accounts.sql`, purge `server/accounts/purge.sql` | `signin.spec.ts`, `sync.spec.ts`, `guards.spec.ts`, `migration.spec.ts`, `routes.spec.ts` in `server/accounts/` |
| S1 free-tier guard | `ACCOUNTS_ENABLED` (server), `VITE_ACCOUNTS` (build; inert until S2), `config/accountsFlag.ts` | `guards.spec.ts` (real in S1); flagless-build check in `scripts/check-google-bundles.sh`; `config/viteConfig.spec.ts`. The flag-on e2e and the flag-on entry-chunk check are S2 placeholders: nothing imports the flag yet, so they cannot fail until S2 |

**S0 measurement (2026-11-07, Node 22, repetitive realistic text; random text in parentheses).** The design's gate, "the
maximum fails above 1.9 MB", is **not met** by a plan at the array maxima of `plannerDocumentSchema`:

| Plan | Serialized | Gzipped and sealed | Zod parse |
|---|---|---|---|
| Every array at its maximum | 15.8 MB (45.7 MB) | **2.32 MB** (21.4 MB) | 0.21 s (0.70 s) |
| Heavy realistic: 20 categories, 100 blocks, 1,000 tasks, 365 check-ins, 5,000 actuals, 500 events | 1.75 MB (5.7 MB) | 0.14 MB (2.87 MB) | 0.06 s |
| 50,000 actuals alone | 12.3 MB | 0.45 MB | 0.11 s |
| 5,000 tasks alone | 1.5 MB (11.8 MB) | 0.21 MB (8.25 MB) | 0.02 s |

The binding limit is the 2 MB request body, not the sealed size: a body under 2,000,000 bytes seals to under 1.9 MB
even for random text (1.99 MB of random letters and digits sealed to 1.39 MB; random printable ASCII cannot be denser than
about 0.82 of its size, so about 1.63 MB; `size.spec.ts` checks the first), so the row cap never trips in practice. The design's
fallback is what is implemented: a plan whose JSON exceeds 2 MB is refused with `413 tooLarge` ("plan too large to sync")
and nothing is stored. Options for the owner, if the maxima must sync: prune old `actuals` before sync (they are 12 MB of
the 15.8 MB), allow a gzip request body with a streamed decompression bound, or split the plan over several rows. A
Zod parse of a heavy plan costs tens of milliseconds of CPU, which is above the Workers Free per-request CPU budget: sync
is expected to need Workers Paid.

**Clarifications made while implementing, none of which changes a decision above:**
- `accounts` also stores `account_key` (`sha256(sub)`, base64url) so deletion can write the tombstone in the same batch
  (SQLite has no SHA); `auth_pending` also stores `consent_version` so the consent shown at sign-in reaches `accounts`.
- `beta_access(email, account_id, created_at)`: the owner inserts a lowercase e-mail; the first sign-in with that verified
  e-mail binds it to the account by `sub`; after that the e-mail is not consulted. A trigger refuses the 101st row.
- Routes: `POST /api/auth/{start,session,signout,delete}`, `GET /api/auth/callback`, `GET`/`PUT /api/sync`,
  `PUT /api/sync/replace`. The account key travels in the `X-Weeklid-Account` header on `GET`. The tombstone check comes
  before the session check on `/api/sync` so an offline device of a deleted account, which has no session left, learns
  `410 accountDeleted`; the cost is that anyone who already holds an account key can learn whether it was deleted.
- "Download my account data" has no route yet: the plan (`GET /api/sync`) and the account record (`POST /api/auth/session`)
  are what S2 composes it from.
- Not built (S2 and later): the client sync engine, Settings › Account, the binding rules of section 2.2, the merge, and the
  10 s lock-hold budget.
