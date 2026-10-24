# Connect your LLM to Next168

Next168 works without an account or companion. Browser mode keeps data in that browser and origin. The optional companion owns a separate workspace on this computer and lets an MCP client read it and submit proposals. A proposal never edits your planner until you approve it in Next168.

## Install and run

Use Node 20.19+ (or Node 22.12+) and a checkout containing deliverable 1. From the repository root:

```sh
npm ci
npm ci --prefix companion
npm run build
npm run companion:build
npm run companion:start
```

The companion listens only on `127.0.0.1:1680` and opens its local page. Use `node companion/dist/cli.js serve --no-open` to open the page manually. `--port 1681` or `NEXT168_PORT=1681` changes the port; configure MCP clients with the same port. `NEXT168_HOME=/absolute/private/directory` changes the data directory from `~/.next168/`. Use the same directory in every companion command and client configuration. Never bind or forward this service to a LAN or the internet.

The terminal prints a one-time pairing code and a URL with `#pair=…`. The fragment stays in the browser, is removed from the address bar and is exchanged by POST for an HttpOnly, SameSite=Strict cookie scoped to `/api`. No token is embedded in HTML. Codes expire after ten minutes and cannot be reused. A new browser can pair with a fresh code:

```sh
node companion/dist/cli.js pair
```

Sessions expire after 24 hours and on companion restart. Only the paired browser can change the document, approve/reject a proposal, import a workspace or manage calendar source texts. If the browser loses its session, the pairing screen appears; it never switches silently to localStorage.

The companion stores `planner.json`, `planner.json.bak`, `proposals.json`, `mcp-token` and `calendars/<sourceId>.ics` in its private data directory. JSON and calendar writes use a synced temporary file and atomic rename, with a backup of previous bytes. A single companion process holds the workspace lock. After a crash, a lock is reclaimed only when its recorded PID no longer exists; an unreadable lock blocks startup for inspection. Files left by an interrupted write do not replace the primary.

If the primary document is corrupt, Next168 blocks writes and offers a valid backup in the recovery screen. It never automatically restores or resets data. Restoration keeps both the backup and a separate copy of the corrupt bytes. A `durability-unknown` warning means rename committed but directory sync failed; the write is successful, and reloading reads the committed file. Preserve your backup before investigating disk errors.

## Move an existing workspace

Export a Next168 backup from the old browser/origin. Open **Settings → Connect your LLM** in the paired companion page and import it into the empty workspace. The transfer includes raw calendar source texts; after import the client reads the saved document and source texts again and compares their content hash. The destination assigns its next revision, so verification compares against that normalized revision. Keep the original export if verification fails.

The workspace identifier is retained; a proposal from another workspace is rejected. Pending proposals do not travel in an export. Ask for new proposals after transferring. Before adding Next168 to an iPhone Home Screen, export first, then import from inside the installed app; browser and installed origins can have different storage.

## Claude Desktop

Start the companion first. In Claude Desktop's developer settings, edit `claude_desktop_config.json`. Merge this entry with existing servers, replace the absolute paths, and restart Desktop:

```json
{
  "mcpServers": {
    "next168": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/next168/companion/dist/cli.js", "mcp"],
      "env": {
        "NEXT168_HOME": "/absolute/path/to/.next168",
        "NEXT168_PORT": "1680"
      }
    }
  }
}
```

The stdio process proxies tools to the running companion; it never opens another file writer. If serve is unavailable or the token has rotated, it exits with an actionable error. `.mcpb` packaging is deferred. Desktop configuration locations and managed-device restrictions are described in [Anthropic's local MCP guide](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop).

## Claude Code

From your chosen local project, with the companion running:

```sh
claude mcp add --transport stdio next168 -- node /absolute/path/to/next168/companion/dist/cli.js mcp
```

For a non-default workspace or port, use `--env NEXT168_HOME=/absolute/path --env NEXT168_PORT=1681` before the server name. See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp) for scopes, server status and project trust.

Ask: “Read my week, then propose one focus block. Do not apply anything.” Next168 shows a pending-proposal badge within five seconds while the page is visible. Open it, examine every before/after operation and overlap/goal warning, then approve or reject. Approval binds the proposal id, immutable content hash and base revision. A stale planner requires a fresh proposal. Repeated approval returns the original applied revision; it does not create another block, including after a crash between the document and proposal-status writes.

## HTTP clients and protocol support

`http://127.0.0.1:1680/mcp` uses Streamable HTTP with `Authorization: Bearer <token from ~/.next168/mcp-token>`. Do not put the token in a URL, public config, Git, screenshot or transcript. The stdio adapter reads the file itself, so it needs no token in its configuration. Native HTTP clients can omit Origin but must supply the bearer. Browser requests must match the exact loopback Host and allowed Origin; wildcard CORS is never enabled. This private fixed-token endpoint does not claim OAuth interoperability.

Rotate the token to revoke existing MCP clients, then reconnect them:

```sh
node companion/dist/cli.js token rotate
```

The CLI prints the token's file location, never its value. Rotation does not grant or revoke browser approval sessions.

The official TypeScript SDK v2 packages are pinned to server/client `2.3.1` (2026-10-05) and Node adapter `2.1.1` (2026-10-02); esbuild `0.25.10` bundles the CLI and the same `src/core` used by the app. These versions predate 2026-10-10. SDK v2 uses Apache-2.0; esbuild and Zod use MIT. Both licenses are permissive; no GPL/AGPL dependency is added. SDK v1 was rejected because its legacy protocol default alone does not establish current-revision support. The [official SDK v2 documentation](https://ts.sdk.modelcontextprotocol.io/v2/) describes current MCP `2026-07-28` support and legacy serving. Integration tests explicitly pin modern clients to that revision and separately exercise legacy clients on both HTTP and stdio. The legacy `LATEST_PROTOCOL_VERSION` export remains `2025-11-25`; it is not the modern negotiation entry point.

Exactly eight tools are exposed: `get_week`, `list_categories`, `list_blocks`, `list_tasks`, `list_events`, `get_stats`, `propose_changes`, `get_proposal`. Schemas come from the shared Zod contracts via `z.toJSONSchema`. Responses contain structured content and short text. There is no apply tool. `list_events` returns planner events only. Imported and subscribed calendars are expanded in the app, so `externalEvents` is empty and an explicit `external-calendar-expansion-unavailable` warning is returned when calendar sources exist; it never claims those sources have no events.

## Browser-only assistants

In **Settings → Connect your LLM**, use **Export snapshot + prompt**. The file contains workspace/revision, categories, blocks without notes, tasks, core-computed statistics and the proposal JSON schema. Share only the data you intend to send. Paste the assistant's proposal into **Import proposal JSON**, then review it in the same proposal screen. Importing a proposal does not apply it. Wrong-workspace, invalid or stale proposals are rejected.

## ChatGPT and privacy

ChatGPT cannot reach this local-only listener directly. OpenAI documents an optional [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels) that creates an outbound path to supported OpenAI products and requires separate account/workspace permissions. Enabling it changes the connection boundary and requires the user's choice; Next168 neither implements nor starts a tunnel. Use snapshot export/import to keep this deliverable local.

A cloud assistant receives whatever its tools return; local storage does not make cloud inference private. `get_week` excludes block notes, but explicit list tools return their corresponding records. Planner titles, notes and calendar text are untrusted data, never executable instructions. MCP clients have read/propose authority only. An agent controlling the user's own browser or OS session is outside this boundary, as with other local applications. Do not give untrusted code that authority.

Calendar URL fetching is UI-only. It accepts HTTP/HTTPS, strips URL credentials, resolves and validates every address, rejects private/loopback/link-local/multicast and reserved transition ranges, pins the validated address, revalidates up to three redirects, and caps decompressed content at 5 MiB and the whole operation at ten seconds. No subscriptions are fetched in the background.

## Repeatable verification and real Claude evidence

```sh
npm run type-check
npx eslint .
npx vitest run
npm run build
npm run companion:build
npm --prefix companion test
npx playwright test e2e/connect.spec.ts
```

Root CI must install the separate companion package before running the Connect spec: `npm ci --prefix companion`. The companion test script builds the CLI before running its suite, so stdio tests cannot pass against an old bundle after a failed build. A build failure stops verification. The root package adds only the two authorized companion scripts; the smoke script belongs to the companion package:

```sh
npm --prefix companion run companion:smoke
```

Run the smoke command outside restricted sandboxes, with a locally authenticated Claude CLI. It starts its own loopback companion in a temporary synthetic workspace, invokes a real `claude -p --strict-mcp-config --mcp-config …` session with only `get_week` and `propose_changes` permitted, captures the JSONL transcript and stderr outside Git, and verifies exactly one pending block proposal while the document revision and blocks remain unchanged. It terminates only its own processes and prints the private evidence directory. Failure to connect, a missing tool call or a nonzero Claude result fails the script.

Attach the synthetic transcript and `report.json` to the PR body after checking they contain no credentials. Record Claude's version/model and the source/base/PR HEAD with UTC. The smoke does not impersonate UI approval; Playwright separately proves the badge → review → approve → visible block flow and revision +1. To review the actual smoke proposal, restart serve with the printed `NEXT168_HOME` and `NEXT168_PORT`, pair the browser with its new code, then approve it yourself. Keep or delete that synthetic workspace deliberately.

No real Claude session or browser result is implied by the existence of this script or spec. Record observed results in the PR.

## Integration limits recorded on 2026-10-24

The inherited Zod `4.6.5` pin has the high-severity [oversized-collection validation advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5). HTTP request/collection bounds and the SDK's tool-input bounds reduce this surface, but are not a substitute for the dependency fix. The first fixed version, `4.6.6`, was published 2026-10-11 and does not yet meet this task's minimum fourteen-day dependency age on 2026-10-24. The coordinator must resolve that constraint before security acceptance; this slice does not silently update the shared pin or waive the age requirement.
