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
every `/api/google/*` route answers `404`; with `APP_ORIGIN` but without `GOOGLE_SERVER_ENABLED=1`, `503 disabled`.
Pull-request previews have no variables, so they stay at `404`. The static app does not call these routes until the
client of slice S1b ships behind `VITE_GOOGLE_SERVER`.

| Path | Role |
|---|---|
| `functions/api/google/{connect,callback,token,status,disconnect}.ts` | One-method Pages adapters |
| `functions/api/google/canary/{index,script}.ts` | Temporary owner canary page, removed by slice S1c |
| `server/google/` | The framework-free core: guards, configuration, crypto, Google OAuth, D1 store, handlers |
| `server/google/purge.sql` | The rollback purge, in its required order |
| `public/_routes.json` | Runs Functions only for `/api/google/*`; every other path stays a static asset |

On GitHub Pages and in the companion there are no Functions; `_routes.json` ships as an inert file. A `GET` on a
POST-only route falls through to the static app, as Pages does for any method without a handler.

**Configuration** is set in the Cloudflare dashboard, **Production only**, never in the repository; there is no
`wrangler.toml`. No agent sees these values.

| Name | Kind | Value | When |
|---|---|---|---|
| `DB` | D1 binding | the D1 database `weeklid` | step C (canary) |
| `GOOGLE_TOKEN_KEY` | secret | `openssl rand -base64 32`, generated locally (exactly 32 bytes) | step C |
| `APP_ORIGIN` | variable | `https://weeklid.crexative.com` (no trailing slash) | step C |
| `GOOGLE_SERVER_ENABLED` | variable | `1` | step C |
| `GOOGLE_CLIENT_SECRET` | secret | from Google Console | step D1 (full-path smoke) |
| `VITE_GOOGLE_SERVER` | build variable | `1` | step D3, after slice S1b |

`VITE_GOOGLE_CLIENT_ID` (already a production variable) is read at runtime too; `GOOGLE_CLIENT_ID` is the fallback
name if the build variable is not visible to Functions. A variable change applies at the next deployment: after
changing one, retry the latest production deployment.

**Canary (owner step C, no secret).** After setting the four step-C values and retrying the deployment, open
`https://weeklid.crexative.com/api/google/canary`, press **Start**, consent, and read the page: `PASS: canary, then
notConnected` means the consent round trip and the device cookie work on that browser. Record PASS or FAIL for desktop
Chrome, iPhone Safari, Android Chrome and the two home-screen icons, then remove Weeklid at
`myaccount.google.com/connections`. The canary never exchanges the code while `GOOGLE_CLIENT_SECRET` is absent.

**Logs** carry one line per request, `{"r","o","s","ms"[,"e"]}`: the route, a closed outcome code, the status, the
duration and at most an error class. Nothing else is logged.

**Stopping and purging (rollback).**
1. Remove `GOOGLE_SERVER_ENABLED` and retry the deployment. Observe the stop in the site's console:
   `fetch('/api/google/token', {method: 'POST', headers: {'X-Weeklid': '1'}})` answers `{"code":"disabled"}`.
2. Only after that, wait 60 s, then run `server/google/purge.sql` against `weeklid` (dashboard D1 console, statements in
   the given order, or `npx wrangler d1 execute weeklid --remote --file server/google/purge.sql` from the owner's
   machine). Expect `0 | 0`; read the counts again 60 s later and expect `0 | 0` again. Pending rows go first: a
   credential is only ever inserted from a pending row, so nothing can recreate one afterwards.

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
an in-memory SQLite (`node:sqlite`, Node ≥ 22.13) and never contacts Google.

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
