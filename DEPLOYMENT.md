# Weeklid - Deployment Guide

This guide covers deploying Weeklid to various hosting platforms.

## Table of Contents

- [Quick Start](#quick-start)
- [Build Process](#build-process)
- [Platform-Specific Guides](#platform-specific-guides)
  - [Vercel](#vercel)
  - [Netlify](#netlify)
  - [GitHub Pages](#github-pages)
  - [Cloudflare Pages](#cloudflare-pages)
    - [Functions (Google connection server)](#functions-google-connection-server)
    - [Functions (accounts and sync, off by default)](#functions-accounts-and-sync-off-by-default)
- [Custom Domain Setup](#custom-domain-setup)
- [Environment Configuration](#environment-configuration)
- [Production Checklist](#production-checklist)

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Run type checking
npm run type-check

# 3. Build for production
npm run build

# 4. Preview build locally (optional)
npm run preview
```

The production build will be output to the `/dist` directory.

## Build Process

### Build Command

```bash
npm run build
```

This command:
1. Runs TypeScript type checking with `vue-tsc`
2. Compiles and bundles the application with Vite
3. Minifies and optimizes all assets
4. Outputs to `/dist` directory

### Build Output

```
dist/
├── assets/
│   ├── index-[hash].js       # Main application bundle
│   ├── index-[hash].css      # Compiled styles
│   └── ...                   # Other chunked assets
├── index.html                # Entry HTML file
└── favicon.ico               # App icon
```

## Platform-Specific Guides

### Vercel

Vercel provides zero-config deployment for Vite applications.

#### Via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Deploy
vercel

# Deploy to production
vercel --prod
```

#### Via Vercel Dashboard

1. Go to [vercel.com](https://vercel.com)
2. Click "Add New Project"
3. Import your Git repository
4. Vercel auto-detects Vite configuration
5. Click "Deploy"

**Build Settings** (auto-configured):
- Build Command: `npm run build`
- Output Directory: `dist`
- Install Command: `npm install`

#### Environment Variables

No environment variables required for Weeklid.

### Netlify

#### Via Netlify CLI

```bash
# Install Netlify CLI
npm i -g netlify-cli

# Build
npm run build

# Deploy
netlify deploy

# Deploy to production
netlify deploy --prod
```

#### Via Netlify Dashboard

1. Go to [netlify.com](https://netlify.com)
2. Click "Add new site" > "Import an existing project"
3. Connect to your Git provider
4. Configure build settings:
   - **Build command**: `npm run build`
   - **Publish directory**: `dist`
5. Click "Deploy site"

#### netlify.toml Configuration

Create `netlify.toml` in project root:

```toml
[build]
  command = "npm run build"
  publish = "dist"

[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### GitHub Pages

https://crexative.github.io/next168/ is deployed by `.github/workflows/deploy.yml`. It runs after the `CI` workflow
succeeds on a push to `main` (type-check, lint, unit, build, e2e: the `verify` gate), checks out that same commit,
builds it with Node 22 and `VITE_PUBLIC_URL=https://weeklid.crexative.com/`, and publishes `dist`. A failed or
cancelled CI run deploys nothing; `workflow_dispatch` redeploys the current `main` by hand.

The build uses `base: './'`, so the same `dist` works at `/next168/` without a sub-path setting. The first deploy of
this app replaces the old "Next168" app (05d781d) at the same address; its planner (localStorage `next168-data`)
is imported on first load. `e2e/upgrade-from-production.spec.ts` builds that old app from Git and proves the upgrade.

### Cloudflare Pages

The official address, https://weeklid.crexative.com/, is the Cloudflare Pages project `next168`, which builds the
`main` branch (production) and pull requests (previews):

- **Build command**: `npm run type-check && npm run build-only -- --base /`
- **Build output directory**: `dist`
- **Production variables**: `NODE_VERSION=22.16.0`, `VITE_PUBLIC_URL=https://weeklid.crexative.com/`

Cloudflare builds on every push to `main` on its own, without waiting for CI: only a `main` that is merged through a
green `verify` keeps that address safe.

### Functions (Google connection server)

The same Pages project also deploys `functions/`: the server that keeps a Google Calendar connection for a device
(design: permanent Google connection, slice S1). It is **dormant until the owner configures it**: with no variables,
every `/api/google/*` route answers `404`; with `APP_ORIGIN` but without `GOOGLE_SERVER_ENABLED=1`, the POST routes
answer `503 disabled` and the callback answers `303` to `/?google=disabled#/settings/calendars`.
Pull-request previews have no variables, so they stay at `404`. The static app calls these routes only in a build with
`VITE_GOOGLE_SERVER=1` (slice S1b, below); every other build, including previews and GitHub Pages, never does.

| Path | Role |
|---|---|
| `functions/api/google/{connect,callback,token,status,disconnect}.ts` | One-method Pages adapters |
| `server/google/` | The framework-free core: guards, configuration, crypto, Google OAuth, D1 store, handlers |
| `server/google/purge.sql` | The rollback purge, in its required order |
| `public/_routes.json` | Runs Functions only for `/api/google/*`; every other path stays a static asset |

On GitHub Pages and in the companion there are no Functions; `_routes.json` ships as an inert file. A `GET` on a
POST-only route falls through to the static app, as Pages does for any method without a handler.

**Configuration** is set in the Cloudflare dashboard, **Production only**, never in the repository; there is no
`wrangler.toml`. No agent sees these values.

| Name | Kind | Value | When |
|---|---|---|---|
| `DB` | D1 binding | the D1 database `weeklid` | step C |
| `GOOGLE_TOKEN_KEY` | secret | `openssl rand -base64 32`, generated locally (exactly 32 bytes) | step C |
| `APP_ORIGIN` | variable | `https://weeklid.crexative.com` (no trailing slash) | step C |
| `GOOGLE_SERVER_ENABLED` | variable | `1` | step C |
| `GOOGLE_CLIENT_SECRET` | secret | from Google Console | step D1 (full-path smoke) |
| `VITE_GOOGLE_SERVER` | build variable | `1` | step D3, after slice S1b |
| `VITE_GOOGLE_SERVER_INSTALLED` | build variable | `1`, only after gate G-1 passed (below) | step G-1 |

`VITE_GOOGLE_CLIENT_ID` (already a production variable) is read at runtime too; `GOOGLE_CLIENT_ID` is the fallback
name if the build variable is not visible to Functions. A variable change applies at the next deployment: after
changing one, retry the latest production deployment.

**The app client (slice S1b).** A build with `VITE_GOOGLE_CLIENT_ID` and `VITE_GOOGLE_SERVER=1` keeps a device connected
through these routes; the build fails on any other value, on `VITE_GOOGLE_SERVER=1` without a client ID, and on
`VITE_GOOGLE_SERVER_INSTALLED=1` without `VITE_GOOGLE_SERVER=1` (`config/googleServerFlags.ts`). Such a build keeps no
Google event or token on the device, in any context, and erases the copy of an earlier build at every boot. Only
positively identified top-level Safari, Chrome, Edge, Firefox, Brave, Opera, Yandex, UC Browser and Samsung Internet
tabs use the server on their supported platforms; in-app browsers and (until gate G-1) installed apps stay on Google
Identity Services (`docs/design/google-permanent-connection-s1b.md`, section 2.1). `bash scripts/check-google-bundles.sh`
(run by CI) builds each flag row and checks what it may carry: no `api/google` without the flag, and neither Google module
in the entry chunk of a server build.

Owner rollout, in order:
1. Merge S1b.
2. Set `GOOGLE_CLIENT_SECRET` and `VITE_GOOGLE_SERVER=1`, redeploy, and run acceptance checks A-16 (connect, reload and
   reopen the next day in desktop Chrome, iPhone Safari and Android Chrome) and A-17 (Connections, Details > Connection
   source reads `server` in desktop Chrome, Edge, Safari, Firefox, Brave, Opera/Opera GX, Yandex and UC Browser;
   Android Chrome, Edge, Firefox, Samsung Internet, Opera Mobile, Brave, Yandex and UC Browser; and iPhone Safari,
   Chrome, Edge, Firefox, Brave and Opera. Check `gis` in DuckDuckGo on desktop, Android and iPhone, plus Opera Mini,
   Vivaldi, Arc, plain Chromium, Instagram/Gmail/Facebook in-app browsers and home-screen apps without the installed
   flag. Record any mismatch in the rollout notes).
3. Gate G-1 (A-18): on a build that also sets `VITE_GOOGLE_SERVER_INSTALLED=1` (a preview with variables, or production with
   an immediate revert), Details > Connection source must read `server` in each home-screen app; connect there and
   force-close the app: it must still be connected. If either platform fails, leave `VITE_GOOGLE_SERVER_INSTALLED` unset.
4. A-19 over 8 days: two devices on one account, Disconnect on one, and the other shows the reconnect message on its next
   open; in Testing, expect the reconnect message at about day 7 or 8 (Google's 7-day expiry).
5. A-15: `GET https://weeklid.crexative.com/api/google/canary` now returns the app, not a page of results.

Rollback of the client: unset `VITE_GOOGLE_SERVER` and redeploy; every tab is on Google Identity Services again and the
server credentials stay unused until the 190-day sweep or the purge below. The hard stop is still removing
`GOOGLE_SERVER_ENABLED`.

**Logs** carry one line per request, `{"r","o","s","ms"[,"e"]}`: the route, a closed outcome code, the status, the
duration and at most an error class. Nothing else is logged.

**Stopping and purging (rollback).**
1. Remove `GOOGLE_SERVER_ENABLED` and retry the deployment. Observe the stop in the site's console:
   `fetch('/api/google/token', {method: 'POST', headers: {'X-Weeklid': '1'}})` answers `{"code":"disabled"}`.
2. Only after that, wait 60 s, then run `server/google/purge.sql` against `weeklid` (dashboard D1 console, statements in
   the given order, or `npx wrangler d1 execute weeklid --remote --file server/google/purge.sql` from the owner's
   machine). Expect `0 | 0`; read the counts again 60 s later and expect `0 | 0` again. Pending rows go first: a
   credential is only ever inserted from a pending row, so nothing can recreate one afterwards.
3. Then delete the `GOOGLE_TOKEN_KEY` secret from the Pages project (crypto-shredding). D1 Time Travel keeps
   restorable copies of the database, ciphertexts included, for up to 30 days (Workers Paid; 7 days on Free); without
   the key those copies cannot be decrypted. Deleting rows or the key does not revoke anything at Google: each refresh
   token stays valid until the user removes Weeklid at `myaccount.google.com/connections` or the token expires. A later
   restart needs a new key, and every device then connects again.

**Local development** uses only synthetic values (never a real key or secret; `.dev.vars` and `.wrangler/` are
ignored):

```bash
npm run build
npx wrangler pages dev dist --local-protocol=https --d1 DB --persist-to .wrangler/state \
  --binding APP_ORIGIN=https://127.0.0.1:8788 --binding GOOGLE_SERVER_ENABLED=1 \
  --binding GOOGLE_TOKEN_KEY=<synthetic 32-byte base64> \
  --binding VITE_GOOGLE_CLIENT_ID=123456789012-example.apps.googleusercontent.com
```

`GOOGLE_OAUTH_TEST_ORIGIN` (a fake OAuth origin) and `GOOGLE_TEST_FAULT` exist for the test harness and are ignored
unless the origin is `https://<name>.test:<port>`. The unit suite is `npx vitest run server`; it runs the exact SQL on
an in-memory SQLite (`node:sqlite`) and never contacts Google. The repository needs Node 22.13 or later (`package.json`
engines): Wrangler requires Node 22 and `node:sqlite` is available without a flag from 22.13. CI uses Node 22 and
Cloudflare builds with `NODE_VERSION=22.16.0`.

### Functions (accounts and sync, off by default)

Slices S0 and S1 of `docs/design/accounts-and-sync.md`: Google sign-in and a server copy of the plan. **It ships switched
off and invisible.** With `ACCOUNTS_ENABLED` unset (or anything other than `1`) every `/api/auth/*` and `/api/sync*`
route answers `404`, reads and writes nothing, calls nobody and sets no cookie. The static app has no account code yet
(the client is slice S2): a build made with `VITE_ACCOUNTS=1` is inert, and a build without it carries no reference to
`/api/auth` or `/api/sync` (`bash scripts/check-google-bundles.sh`, run by CI). The only check of the client flag that can fail in S1 is the flagless build ("no `/api/auth` or `/api/sync`"); the
flag-on bundle check and the flag-on half of `e2e/accounts-free-tier.spec.ts` are S2 placeholders that start to bite when
the client lands. The server's off-by-default behaviour is proven by `server/accounts/guards.spec.ts`. The calendar connection above is not touched: sign-in asks for
`openid email profile` only and stores no Google token.

| Path | Role |
|---|---|
| `functions/api/auth/{start,callback,session,signout,delete}.ts` | One-method Pages adapters for sign-in |
| `functions/api/sync/{index,replace}.ts` | `GET`/`PUT /api/sync`, `PUT /api/sync/replace` |
| `server/accounts/` | The framework-free core: configuration, ID token checks, D1 store, plan codec, handlers |
| `server/accounts/migrations/0001_accounts.sql` | Additive, idempotent migration; creates only new tables and never touches `google_*` |
| `server/accounts/purge.sql` | The rollback purge, in its required order; leaves the database as it was before the migration |
| `public/_routes.json` | Runs Functions only for `/api/google/*`, `/api/auth/*`, `/api/sync` and `/api/sync/*` |

| Name | Kind | Value |
|---|---|---|
| `ACCOUNTS_ENABLED` | variable | `1` to switch on; anything else (or absent) is off |
| `SYNC_KEY` | secret | `openssl rand -base64 32`, generated locally (exactly 32 bytes); seals plans and sign-in secrets |
| `GOOGLE_CLIENT_SECRET`, `VITE_GOOGLE_CLIENT_ID` (or `GOOGLE_CLIENT_ID`), `APP_ORIGIN`, `DB` | as for the Google connection server | the same values; sign-in reuses the Google client |
| `VITE_ACCOUNTS` | build variable | leave **unset** until slice S2 ships; `1` only builds the (still inert) client flag |

Routes answer `503 notConfigured` when a value above is missing or malformed, or when migration 1 has not been applied.
Logs are the same closed line `{"r","o","s","ms"[,"e"]}`, with routes `auth.*` and `sync.*`; no e-mail, subject, plan or
token is ever logged.

**Owner steps to switch it on, in order** (preview first; nothing here is done by an agent):
1. **Before inviting anyone:** the lawyer review and the published *Política de Tratamiento* of OD-4 (spending approval
   is yours). Crexative S.A.S. is the controller.
2. Create a preview database (`weeklid-preview`) and bind it as `DB` in the **Preview** environment, so the canary below
   never touches production data.
3. Google Cloud console, the existing web OAuth client: add the redirect URI
   `https://<preview host>/api/auth/callback` (and later `https://weeklid.crexative.com/api/auth/callback`). Do not add
   scopes; the consent screen keeps listing the calendar scope for the connection above.
4. Generate `SYNC_KEY` locally and set it as a Preview secret. Never paste it anywhere else.
5. Apply the migration to that database and check it:
   `npx wrangler d1 execute weeklid-preview --remote --file server/accounts/migrations/0001_accounts.sql`, then
   `SELECT version FROM schema_migrations;` returns `1`. Running it twice is harmless.
6. Invite people (at most 100; the database refuses the 101st): `INSERT INTO beta_access (email, created_at) VALUES
   ('person@example.com', strftime('%s','now'));` with the address in lowercase. Removing a row ends that person's access
   at once and frees the seat.
7. Set `ACCOUNTS_ENABLED=1` on Preview and retry the deployment.
8. **Canary R-G1** (a person who is not a Google test user signs in; there must be no unverified-app warning). There is no
   sign-in button until S2, so from the preview page's console:
   `fetch('/api/auth/start',{method:'POST',headers:{'X-Weeklid':'1','Content-Type':'application/json'},body:'{"consent":1}'}).then(r=>r.json()).then(({url})=>location.assign(url))`.
   Expect Google's account chooser, then a redirect to `/?account=signedIn#/settings/account`.
9. **Canary S0** (a bound BLOB above 100 KB on a D1 database; preview only). In the same console:
   ```js
   const h = { 'X-Weeklid': '1', 'Content-Type': 'application/json' }, now = '2026-10-20T10:00:00.000Z'
   const note = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(150))))
   const document = { schemaVersion: 3, workspaceId: 'canary', revision: 1, generation: 0, updatedAt: now,
     settings: { locale: 'en', weekStartsOn: 1, timeZone: 'UTC', onboardingDone: true, theme: 'system' },
     categories: [], blocks: [], checkIns: [], actuals: [], events: [], calendarSources: [], appliedProposalIds: [], appliedCaptureIds: [],
     tasks: Array.from({ length: 800 }, (_, i) => ({ id: 't' + i, title: 'Task ' + i, priority: 2, createdAt: now, notes: note() })) }
   const { accountKey } = await (await fetch('/api/auth/session', { method: 'POST', headers: h })).json()
   const put = await fetch('/api/sync', { method: 'PUT', headers: h, body: JSON.stringify({ accountKey, baseRevision: 0, epoch: 0, document }) })
   console.log(put.status, await put.text())
   ```
   Expect `200 {"epoch":1,"revision":1}`, and `SELECT length(payload) FROM plans;` above 100000. A `GET /api/sync` with the
   header `X-Weeklid-Account: <accountKey>` must return the same document. If D1 rejects the bind, stop: the design's
   chunking question reopens and nothing goes to production.
10. Clean the canary with `server/accounts/purge.sql` on the preview database (do not use *Delete account* for this: it
    leaves a permanent tombstone for that Google identity, which is the intended behaviour, OD-9).
11. Production: repeat steps 4 to 7 on the production database. People can only use it once the S2 client ships.

**Stopping and purging (rollback).**
1. Remove `ACCOUNTS_ENABLED` and retry the deployment. Observe the stop: `fetch('/api/auth/session',{method:'POST',headers:{'X-Weeklid':'1'}})` answers `{"code":"notFound"}`.
2. Wait 60 s, then run `server/accounts/purge.sql` (dashboard D1 console, statements in the given order, or
   `npx wrangler d1 execute weeklid --remote --file server/accounts/purge.sql`). It removes sessions first, then pending
   sign-ins, then everything else, and drops the account tables, so the Google connection tables are untouched and the
   routes answer `503 notConfigured` if the switch is ever turned on again before re-running the migration. Purging also
   deletes the deletion tombstones; that is the cost of a full rollback.
3. Delete the `SYNC_KEY` secret (crypto-shredding). D1 Time Travel keeps restorable copies of the database for up to 30
   days (7 on Free). **Account data is never restored from Time Travel** (OD-8): if the database is lost, people sign
   in again, their devices re-upload only after they confirm, and Google Calendar connections must be redone.

## Custom Domain Setup

### DNS Configuration

For `next168.app`:

1. **Add A Record** (for root domain):
   ```
   Type: A
   Name: @
   Value: [Your hosting provider's IP]
   ```

2. **Add CNAME Record** (for www):
   ```
   Type: CNAME
   Name: www
   Value: [Your deployment URL]
   ```

### SSL/TLS

All recommended platforms provide free SSL certificates:
- Vercel: Automatic SSL via Let's Encrypt
- Netlify: Automatic SSL via Let's Encrypt
- Cloudflare Pages: Automatic SSL
- GitHub Pages: Automatic SSL for custom domains

### Platform-Specific Domain Setup

**Vercel:**
1. Project Settings > Domains
2. Add domain
3. Follow DNS configuration instructions

**Netlify:**
1. Site Settings > Domain management
2. Add custom domain
3. Configure DNS records

**Cloudflare Pages:**
1. Project > Custom domains
2. Add domain
3. DNS automatically configured if using Cloudflare DNS

## Environment Configuration

Weeklid is a fully client-side application with no backend dependencies.

### No Environment Variables Required

The application uses:
- **localStorage** for data persistence
- **localStorage** for language preferences
- No API keys
- No backend services

### Build-Time Configuration

All configuration is in `vite.config.ts`:

```typescript
export default defineConfig({
  plugins: [vue(), vueDevTools()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  base: '/', // Update for GitHub Pages if needed
})
```

## Production Checklist

Before deploying to production:

### ✅ Code Quality

- [ ] Run `npm run type-check` (no TypeScript errors)
- [ ] Run `npm run lint` (no linting errors)
- [ ] Test in development mode (`npm run dev`)
- [ ] Build successfully (`npm run build`)
- [ ] Preview build locally (`npm run preview`)

### ✅ Functionality

- [ ] All 3 tabs work correctly (Calendar, Categories, Statistics)
- [ ] Language selector works for all 5 languages
- [ ] Responsive design works on mobile, tablet, desktop
- [ ] Time blocks can be created, edited, deleted
- [ ] Categories can be created, edited, deleted
- [ ] Charts render correctly on Statistics tab
- [ ] localStorage persists data across refreshes
- [ ] Validation prevents overlaps and limit violations

### ✅ Accessibility

- [ ] Color contrast ratios meet WCAG AA (>4.5:1)
- [ ] All interactive elements have aria-labels
- [ ] Keyboard navigation works
- [ ] Screen reader friendly

### ✅ Performance

- [ ] Bundle size is optimized (<500KB total)
- [ ] Images/assets are optimized
- [ ] Lighthouse score >90 for Performance
- [ ] No console errors in production build

### ✅ SEO & Meta

- [ ] `index.html` has correct title: "Weeklid"
- [ ] Meta description is set
- [ ] Favicon is present
- [ ] Theme color is set (#1C2E4A)

### ✅ Deployment

- [ ] Build output is in `/dist`
- [ ] All assets load correctly
- [ ] Routing works (SPA mode)
- [ ] SSL certificate is active
- [ ] Custom domain configured (if applicable)

## Troubleshooting

### Build Errors

**TypeScript errors:**
```bash
npm run type-check
```
Fix all type errors before building.

**Dependency errors:**
```bash
rm -rf node_modules package-lock.json
npm install
npm run build
```

### Deployment Issues

**404 on page refresh:**
- Ensure your hosting platform redirects all routes to `index.html`
- See platform-specific redirect configuration above

**Assets not loading:**
- Check `base` path in `vite.config.ts`
- For subdirectory deployments, set `base: '/subdirectory/'`

**White screen:**
- Check browser console for errors
- Verify all assets loaded correctly
- Test with `npm run preview` locally

## Performance Optimization

### Already Optimized

Weeklid is built with performance in mind:
- ✅ Vite code splitting
- ✅ CSS minification
- ✅ Tree shaking
- ✅ Lazy loading for routes (if added)

### Further Optimization

**Bundle Analysis:**
```bash
npm run build -- --mode analyze
```

**Compression:**
Most hosting platforms automatically enable gzip/brotli compression.

## Monitoring

### Recommended Tools

- **Vercel Analytics**: Built-in for Vercel deployments
- **Cloudflare Analytics**: Built-in for Cloudflare Pages
- **Google Analytics**: Add to `index.html` if needed
- **Sentry**: Error tracking (optional)

## Support

For deployment issues:
1. Check platform-specific documentation
2. Review Vite documentation: https://vitejs.dev/guide/static-deploy.html
3. Open an issue on GitHub

---

**Weeklid** - Plan your next 168 hours, effortlessly.

🌐 [next168.app](https://next168.app)

## Content Security Policy

`index.html` carries the policy as a `<meta http-equiv="Content-Security-Policy">` first in `<head>`, so it holds on Cloudflare Pages, GitHub Pages, `vite preview` and the companion alike (the companion also sends its own header; the two combine, the stricter wins). Scripts must be external files: the pre-paint theme and language script is `public/prepaint.js`. Nothing may need `unsafe-eval`: vue-i18n runs in JIT mode (`vite.config.ts`) and zod is jitless (`src/zodWithoutEval.ts`). `connect-src` stays `https: http:` because calendar subscriptions fetch arbitrary feed URLs, so the policy blocks injected scripts but does not limit where data can be sent. `e2e/csp.spec.ts` walks the app and fails on any `securitypolicyviolation`.
