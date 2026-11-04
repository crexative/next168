# Google OAuth spike (S0)

This standalone owner-operated probe is never imported by Weeklid. It uses only
Node built-ins and requires the repository's supported Node version. It does not
change the app, deploy anything, or establish that Google has passed the probes.
S0 is **critical**: before merging it, obtain an independent App review from a
provider different from the author and the owner's `OWNER-ACK <sha>` for the exact
PR HEAD.

## Owner procedure (design §8.1 v4; owner step B)

1. After S0 merges, keep the Google OAuth consent screen in **Testing**. In the
   existing **Web application** OAuth client, register
   `https://weeklid.crexative.com/api/google/callback` and temporarily register
   `http://localhost:8788/api/google/callback`. Create a client secret and keep it
   in your password manager. Do not send it to an agent.
2. In an interactive terminal, from the repository root, run:

   ```sh
   node scripts/spikes/google-oauth-spike.mjs --client-id YOUR_PUBLIC_ID.apps.googleusercontent.com
   ```

   The public client ID is the only CLI value. Enter the secret once at the
   hidden prompt. Never place it in arguments, environment variables, files,
   shell history, logs, screenshots, or a recorded terminal session. Echo is
   disabled during entry, then restored in `finally` and on SIGINT/SIGTERM.
   Ctrl-C at the raw input prompt takes the same interruption path.
3. Open each printed consent URL yourself and use the **same Google account**
   throughout. Consent uses `calendar.events.readonly`, offline access,
   `prompt=consent`, a fresh random state and a fresh PKCE S256 challenge. Only
   the callback listener binds `localhost:8788`, and only during consent (up to
   five minutes per consent). Leave that port free on both loopback addresses.
   The run order is **P1, P2a, P2b, P2c, P1′, P3, P4, then cleanup**.
   Each of the seven cases has a fresh authorization, as §8.1 specifies.
   P3/P4 exchange their own fresh codes, while their measured operations still
   use RT1/RT2 from P1/P1′. Additional refresh tokens also enter cleanup.
4. Copy the result rows and the date into `docs/calendars.md`. No tokens, codes,
   emails, events or provider error descriptions are printed. Labels identify
   booleans and HTTP statuses; `0` means no usable HTTP response. The only
   provider text retained for reporting is an `error` code matching
   `[a-z_]{1,40}` (for example, `P2a error invalid_grant 400`). Raw bodies,
   descriptions and event data are discarded; tokens stay in memory only as
   needed for the probe and revocation. A refresh token returned by any negative
   case is explicitly labelled `unexpected-token yes <status>`, including when
   its HTTP response is a failure, and enters cleanup. Preconditions, consent
   URLs, the hidden-input prompt, cleanup rows and the final removal reminder
   are the necessary output exceptions. Do not copy consent URLs into the report.
5. **After every run, regardless of the printed results or exit code**, remove
   **Weeklid** at [Google account connections](https://myaccount.google.com/connections).
   Then delete the temporary `http://localhost:8788/api/google/callback` redirect
   URI in Google Console. Keep the production redirect URI.

The helper prints the owner preconditions before requesting the secret: Calendar
API enabled, owner registered as a test user, and the exact callback URI registered.
These are reminders, not claims that the helper verified Google Console.
Node versions below 20 are refused.

The callback uses **exactly** `http://localhost:8788/api/google/callback` in both
the authorization URL and the token POST. Two explicit listeners bind
`127.0.0.1:8788` and `[::1]:8788` (`ipv6Only: true`), covering either browser
resolution of `localhost` without wildcard binding. Both must be available; a
bind failure stops the probe with exit 2 and closes any listener already opened.
The browser receives "You can close this tab" after a valid callback. A rejected
state prints `callback stateMismatch no 400` and aborts the partial run. Both
listeners close after each consent, including timeout, failure and interruption.

Exit **0** means the table completed, **2** means a precondition, callback,
network or timeout aborted the table, and **130** means SIGINT (also SIGTERM).
Cleanup failure is reported per token even when the completed table exits 0.
An interrupt during cleanup still exits 130 while cleanup keeps its own deadlines.

If interrupted or terminated, do step 5 even if nothing was printed. SIGKILL,
power loss, a lost exchange response or an unavailable network can leave grants
behind. If an uncatchable termination leaves terminal echo disabled, run `stty
sane` in that terminal. The helper's exit is not proof of grant removal.

## Reading the results

| Case | Operation / interpretation |
| --- | --- |
| P1 | Correct verifier and secret; expect HTTP 200, a refresh token (RT1), and the events scope. A missing refresh token or scope stops the probe; redesign before proceeding. |
| P2a | Fresh code, wrong verifier and correct secret; `rejected yes 400` means `invalid_grant`. |
| P2b | Fresh code, omitted verifier and correct secret; expect rejection with HTTP 400. |
| P2c | Fresh code, correct verifier, omitted secret; expect rejection with HTTP 400/401. |
| P1′ | Correct verifier and secret; obtain RT2. |
| P3 | Fresh consent/exchange, then refresh **RT1**; expect HTTP 200, `expires_in` near 3600 (3300–3900 inclusive), then HTTP 200 from primary-calendar events with `maxResults=1`. Event content is discarded. |
| P4 | Fresh consent/exchange, then revoke **RT1** and refresh **RT2**. `other-refresh-survives yes 200` suggests per-device revocation; `invalid-grant yes 400` suggests grant-wide revocation. Any other outcome, or failed revocation, is inconclusive. Record it before selecting Disconnect copy (O-6). |

Keep PKCE in either outcome. If P2a and P2b both reject, record PKCE as defence in
depth. If either succeeds, still keep PKCE, but record that code-injection
protection rests on state, the pending row, exact redirect URI and client secret.
An HTTP/network failure alone does not establish that PKCE is enforced.

Cleanup attempts revocation of **every distinct refresh token obtained**,
including unexpected successful negative probes and rotated refresh tokens.
Each token gets an ordinal row (`cleanup 1 ok 200`, `failed <status>`, or
`unknown 0`), never the token itself. Each attempt, including reading its HTTP
response body, is bounded to five seconds; cleanup uses a separate deadline so Ctrl-C does not cancel it. P4's earlier
revocation does not suppress the final cleanup attempt. `ok` reports the endpoint
response only; it does not prove that every grant has gone. Manual removal is
always mandatory, including when a lost response prevents discovery of a token.

Google Testing refresh tokens can expire after seven days. This spike does not
demonstrate a permanent connection or cross-device behavior over time; those
owner observations remain later gates.

## Local verification, synthetic credentials only

```sh
npm run test:spike
node scripts/spikes/google-oauth-spike.mutations.mjs
```

The fake OAuth server uses an ephemeral `127.0.0.1` port. Real socket tests reach
the callback through `localhost`, `127.0.0.1` and `::1`, then complete consent at
the exact registered localhost URI. Tests execute the actual CLI as a child,
inspect its stdout/stderr and observe its argv/environment while transmitting the synthetic
secret. They never contact Google. The mutation runner requires a green baseline,
then changes one protected behavior at a time in temporary copies and checks the
corresponding test fails; it always removes those copies. Temporary module paths
are canonicalized so macOS path aliases cannot silently skip the CLI entrypoint.
Cleanup checks assert nonzero obtained-token counts and the complete ordered set
of report rows, covering HTTP failure, timeout after headers, and missing rows.
A restricted environment can run the TTY/CLI and stubbed consent/HTTP checks with:

```sh
node --test --test-name-pattern='^unit |SIGINT and|hidden TTY|test endpoint|invalid client' scripts/spikes/google-oauth-spike.test.mjs
node scripts/spikes/google-oauth-spike.mutations.mjs --unit-only
```

The **test-only** environment variable `WEEKLID_OAUTH_SPIKE_TEST_ORIGIN` accepts
only `http://127.0.0.1:<port>`. Its presence, including an empty/invalid value,
**refuses all TTY secret reads**. A valid value selects a fixed, clearly synthetic
in-memory secret, never a user-supplied secret. This is deliberately not a CLI
endpoint flag: changing test endpoints cannot send an entered production secret
to another destination. Unset the variable for owner use. Normal endpoints are
fixed in the module; the secret is sent only in form-encoded POST bodies to
`https://oauth2.googleapis.com/token`. All HTTP redirects are refused, including
307/308, to prevent forwarding a secret body elsewhere. Revocation POST bodies
contain refresh tokens but no client secret.
