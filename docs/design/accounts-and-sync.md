# Accounts and plan sync across devices (v1)

Status: **proposed, revision 2**; risk tier critical (auth, personal data, deletion). Revision 1: `9190e83`, rejected
by Codex (round 1). This revision is against `main` f77ebc0. External pages were read on 2026-11-07 (UTC); no Google,
Apple or Cloudflare production endpoint was called and no secret was read.

**Goal (v1).** A person signs in with Google and sees the same plan on every device where they are signed in.
Nobody has to sign in: without an account, Weeklid behaves exactly as it does today.

## Red-team round 1 resolution

**Coordinator direction (2026-11-07), which the owner may veto:** v1 is Google sign-in plus plan sync, nothing else.
Apple sign-in, iCloud calendars and moving the Google Calendar credential to the account move to *later, after
beta evidence*. As in S1b, we remove machinery instead of fencing it.

| # | Finding (family) | Resolution | Where |
|---|---|---|---|
| 1 | BLOCKER: after A signs out and B signs in, A's plan uploads to B (*data crossing accounts*) | **Resolved.** The local plan stays **bound to the account that synced it**, also after sign-out. With a different account, the plan is never uploaded: the person removes it from this device or cancels the sign-in. An unbound plan is uploaded only after an explicit confirmation. Family check: an import or restore while signed out clears the binding in the same transaction, so a file plan can't inherit A's binding; tests A→B, shared device, import-then-sign-in | §2.2, S2 |
| 2 | BLOCKER: the local `generation` can't order delete-all across devices (*client-chosen order*) | **Resolved.** The server owns `revision` (compare-and-swap) and a **replacement `epoch`**. Delete-all, import and restore raise the epoch, and a write based on an older epoch gets `409 replaced`. The local `generation` and `updatedAt` decide nothing in sync. Family check: no client clock or counter orders anything | §2.3 |
| 3 | MAJOR: the merge assumes ids that check-ins and actuals lack (*incomplete keys*) | **Resolved.** One stable key per collection, one rule for both edits and deletes, and a fallback when the merged plan fails validation. Family check: every field of `plannerDocumentSchema` (`src/core/model.ts:238-260`) is listed, including the two applied-id sets | §2.3 table |
| 4 | MAJOR: after sign-out, the plan stays visible on a shared device (*leftover local data*) | **Resolved.** Sign-out asks whether to remove this account's data from the device. "Remove" reuses the device part of Delete all data, which also forgets this device's Google Calendar permission (S1b). "Keep" says plainly who can still see it | §2.2, S2 |
| 5 | MAJOR: the finish ticket has no expiry or single use; linking isn't bound (*replay and binding*) | **Cut.** With Apple out, the callback is Google's top-level GET, which carries a Lax cookie, so the S1a pattern works and there is **no finish ticket**. The pending row is bound to the flow cookie and consumed atomically. There is only one provider, so there's **no linking** in v1. Family check: replay, a missing or foreign flow cookie, an expired row, and a session cookie that isn't regenerated | §2.1, S1 |
| 6 | MAJOR: no safe D1 upgrade (`CREATE TABLE IF NOT EXISTS` can't add a column) (*schema evolution*) | **Resolved.** v1 **adds only new tables** and alters no S1b table (S3 is out). A versioned migration file, applied before the flag is on; old workers never read the new tables; rollback = flag off, then an ordered purge. Tested against the current S1b schema with rows in it | §2.4, S1 |
| 7 | MAJOR: moving the credential can race Disconnect and strand a grant (*ownership change*) | **Out of v1** (S3 removed): each device keeps its own S1b calendar connection, unchanged. No credential changes owner | §3 |
| 8 | MAJOR: a point-in-time restore can bring a deleted account back (*restore resurrects*) | **Resolved.** There's a deletion ledger. After any restore, the owner's procedure re-applies the current ledger, deletes every session and raises every plan's epoch. What stays recoverable inside the 7/30-day window is disclosed | §2.5 |
| 9 | MAJOR: the iCloud proxy has CSRF, URL-exposure and abuse gaps (*proxy surface*) | **Out of v1** (S5 removed). Recorded requirements for later: a guarded POST, the URL redacted from logs, per-account limits, strict host, redirect and egress checks | §3 |
| 10 | MINOR: guard matrix, Supabase, cost labels, GDPR wording | **Resolved.** The guard matrix covers both flag states, signed in and out, requests and the `sync` key. The Supabase row is corrected, costs are labelled *modeled*, and GDPR is stated as a precaution pending legal review | S1, §1.3, §0 |
| S0 | Measure the real maximum sealed payload | **Resolved.** S0 measures the worst-case serialized, compressed, sealed bytes against D1's 2 MB row limit, and checks a bound BLOB above 100 KB on a preview database | S0 |
| — | Over-engineering to cut | `plans_previous`, the R2 fallback, Apple, iCloud and credential adoption are removed. Merge conflicts keep one local copy only | §4 |

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
**Owner canary (S1):** a sign-in by a non-test user while the consent screen also lists the calendar scope confirms R-G1
holds for this project.

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

The meta key `sync` (in the existing `meta` store: **no IndexedDB version bump**, `storageVersion.ts:16`) holds
`{accountId, epoch, baseRevision, dirty}`. It stays after sign-out, so the plan stays **bound** to that account.

| On sign-in with account X | Result |
|---|---|
| The plan is bound to X | Normal sync |
| The plan is bound to another account | **Never uploaded.** "This device holds another account's plan": **Remove it from this device and continue** (the device part of Delete all data) or **Cancel** (the plan stays local, X's session is deleted) |
| The plan is unbound and empty | Pull X's plan |
| The plan is unbound and has content; X has no plan | "Save this device's plan to your account?" Yes uploads it; no cancels |
| The plan is unbound and has content; X has a plan | **Use my account's plan** (this device's plan downloads first as the existing export) or **Replace my account's plan with this one** (a new epoch) |

**Sign-out** asks: **Remove this account's data from this device** (recommended on a shared device; it reuses the
device part of Delete all data, which also forgets this device's Google Calendar permission) or **Keep it**. The copy
for "Keep it": "Anyone who uses this browser can still see this plan and this device's Google events. It stays linked
to your account and will not be added to another one." An import or restore while signed out clears the binding in the
same transaction.

### 2.3 Sync: server revision, epoch and merge

- Server row: `plans(account_id PRIMARY KEY, revision, epoch, key_id, iv, ciphertext BLOB, updated_at)`.
- **Push:** `PUT /api/sync {baseRevision, epoch, document}` → `UPDATE plans SET … revision = revision + 1 WHERE
  account_id = ? AND revision = ? AND epoch = ?`. Zero rows means `409 {revision, epoch}`. **Replace** (Delete all
  data, import, restore, "replace my account's plan") is `PUT /api/sync/replace {baseRevision}`, which also raises
  `epoch`. **Pull:** `GET /api/sync` with `If-None-Match`.
- **409 on the same epoch:** pull, merge three ways against the base saved in `snapshots` (`sync-base`), commit locally
  through the usual compare-and-swap, push again; after 3 rounds, stop and say so. **409 with a higher epoch
  (`replaced`):** adopt the server's plan; any local changes not yet synced go to `snapshots` (`sync-conflict`, one
  copy, the newest replaces it), with Restore. A device that was offline for weeks therefore cannot bring back a
  deleted plan.
- **Merge rule (the same for edits and deletes):** for each key, a side that differs from the base wins; if both
  sides differ, **the server wins**, and the device's version goes to `sync-conflict`. If the merged plan fails
  `validateDocument` (overlaps, references), the merge is dropped: the server's plan wins whole, and this device's plan
  goes to `sync-conflict`.

| Field | Stable key |
|---|---|
| `categories`, `blocks`, `tasks`, `events`, `calendarSources` | `id` |
| `checkIns` | `date` (`model.ts:70-78`) |
| `actuals` | `(blockId, plannedStartAt)` (`model.ts:80-84`) |
| `settings` | each top-level field |
| `appliedProposalIds`, `appliedCaptureIds` | union, then trim to 200 keeping the server's order first |
| `workspaceId`, `schemaVersion` | must be equal, or it is treated as a replacement |
| `revision`, `generation`, `updatedAt` | local only; never compared in sync |

- **Not synced:** raw calendar texts (up to 5 MiB each, `docs/calendars.md:27`; on another device, subscriptions refresh
  and imported files show the existing "import again" message), proposals, preferences and S1b state.
- **Offline:** everything works locally; `dirty` is pushed on open, on focus, when the connection returns and after a
  commit. There is no timer or background sync.

### 2.4 Server storage and migration

- The plan is gzip-compressed, then sealed with AES-GCM under a new `SYNC_KEY` (reusing `crypto.ts`). That protects
  against a leaked export or console view; it is not end-to-end encryption (OD-5). Logs record only the route, the
  outcome and the duration.
- **Migration:** `server/accounts/migrations/0001_accounts.sql` creates only **new** tables (`accounts`, `identities`,
  `sessions`, `auth_pending`, `plans`, `deleted_accounts`, `beta_access`) and a `schema_migrations(version)` row. It
  never touches `google_pending` or `google_credentials` (`connectionStore.ts:88-109`). The owner applies it before
  setting `ACCOUNTS_ENABLED=1`. The routes answer `503 notConfigured` if version 1 is missing. Old workers never read
  these tables. **Rollback:** flag off (routes give 404), then `server/accounts/purge.sql` deletes sessions, then
  pending rows, then everything else, and the owner deletes `SYNC_KEY`.

### 2.5 Deletion, export and restore

- **Delete account** (Settings › Account): one batch deletes the account, its identity, sessions, plan and beta
  access, and writes `deleted_accounts(sha256(sub), deleted_at)`. The device keeps its local plan only if the person
  chooses to; the binding is cleared either way.
- **Restore procedure** (owner, `DEPLOYMENT.md`): (1) read `deleted_accounts` from the current database; (2) restore;
  (3) re-apply those deletions; (4) `DELETE FROM sessions`; (5) `UPDATE plans SET epoch = epoch + 1`, so every device
  adopts the restored plan and keeps its newer local copy in `sync-conflict`. Ledger rows are purged after 30 days.
  The disclosed copy: deleted data stays restorable by Cloudflare for up to 30 days (7 on Free).
- **Export:** "Download my account data" = the server plan as the existing export bundle plus the account record
  (portability, R-L3; a query under R-L1).

## 3. Later, after beta evidence (not v1)

Apple sign-in (OD-2; it needs a form_post callback with a single-use, hash-stored ticket bound to the device and
account-bound linking), iCloud public links (a guarded POST proxy, URL redaction, per-account limits, strict host,
redirect and egress checks), the Google Calendar credential per account (an atomic move that is fenced against
Disconnect), a calendar list scope, realtime push and end-to-end encryption.

## 4. Slices (the free tier stays unchanged)

| Slice | Executable acceptance |
|---|---|
| **S0** Size | A unit test builds a plan at the schema maxima (`model.ts:246-252`) and a realistic one, serializes, gzips and seals them, and **fails if the maximum exceeds 1.9 MB**. A preview-D1 canary (owner, no production) binds a BLOB above 100 KB. If the maximum fails, v1 refuses to push ("plan too large to sync") and nothing else is built |
| **S1** Server | Node tests over the real handlers with a fake Google: callback replay, a missing or foreign flow cookie, or an expired row → no session; bad `iss`, `aud` or `nonce` → no session; a new session cookie on every sign-in, with only its hash stored; two accounts never share a plan row; deleting leaves zero rows in every table and writes the ledger; the restore script on a fixture resurrects nothing and leaves no session. **Migration:** applied to a database built from today's S1b `SCHEMA` with rows in it, the S1b specs still pass, a second run is a no-op, and purge restores the S1b-only state. **Free-tier guard matrix:** {flag off, flag on} × {signed out}: no request to `/api/auth` or `/api/sync`, and no `sync` meta key; the existing e2e suite passes with the flag off; with the flag on and the person signed out, the same holds after edits, import and Delete all data. **Owner canary:** the R-G1 check |
| **S2** Client | e2e with two browser contexts and a fake server: an edit on A appears on B when B gets focus; concurrent edits to different keys of **every** collection in §2.3 are all kept; the same key changed on both devices (an edit or a delete) → the server wins and Restore brings back the device's version; a merge that would create overlapping blocks → the server's plan wins whole, with Restore; an offline push after a delete-all elsewhere gets `replaced`, nothing deleted comes back, and the local edits sit in `sync-conflict`; two replacements at once → one wins and the other is in `sync-conflict`. **A → sign-out (Keep) → B:** B's server plan stays without A's content, and the device asks to remove or cancel. **Shared device:** A signs out with Remove → nothing of A's (plan, `sync` key, Google permission) remains, and B starts empty. Import while signed out → unbound. `STORAGE_VERSION` is still 3 |

## 5. Rejected and removed

CRDTs (they change the stored format for a single-person plan); realtime WebSockets; a plan normalized into SQL tables;
R2 and `plans_previous` (nothing needs them while S0 holds; Time Travel and `sync-conflict` cover recovery); linking
accounts by email; storing Google tokens for sign-in; KV; Supabase (§1.3); CalDAV app passwords; and everything in §3.

## 6. What the red team should attack (round 2)

1. Can a plan cross accounts through any path: binding left by an interrupted sign-in, two tabs signing in as different
   accounts, or Cancel racing a pull?
2. Merge: a key deleted on one side and edited on the other; `validateDocument` fallback loops; trimming the applied-id
   sets so that a proposal applies twice.
3. Epoch: Replace racing a push in another tab; a lost `sync-base` treated as "everything changed".
4. Callback: login CSRF with an attacker's state and the attacker's flow cookie; whether S1b's `__Host-wl_gflow` and the
   new `__Host-wl_aflow` can interfere.
5. A restore procedure that lies: a ledger read taken after the restore, or sessions reissued before step 4.
6. The free-tier guard: any code path in a flag-off build that loads account code or writes `sync`.
