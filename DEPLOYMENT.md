# Next168 - Deployment Guide

This guide covers deploying Next168 to various hosting platforms.

## Table of Contents

- [Quick Start](#quick-start)
- [Build Process](#build-process)
- [Platform-Specific Guides](#platform-specific-guides)
  - [Vercel](#vercel)
  - [Netlify](#netlify)
  - [GitHub Pages](#github-pages)
  - [Cloudflare Pages](#cloudflare-pages)
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

No environment variables required for Next168.

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

#### Using gh-pages Package

```bash
# Install gh-pages
npm install -D gh-pages

# Add deploy script to package.json
# "deploy": "npm run build && gh-pages -d dist"

# Deploy
npm run deploy
```

#### Manual Deployment

1. Build the project: `npm run build`
2. Go to your repository on GitHub
3. Settings > Pages
4. Source: Deploy from a branch
5. Branch: Select your branch with `/dist` folder
6. Save

#### Update vite.config.ts

If deploying to `https://username.github.io/next168/`:

```typescript
export default defineConfig({
  base: '/next168/',
  // ... rest of config
})
```

### Cloudflare Pages

#### Via Cloudflare Dashboard

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com)
2. Pages > Create a project
3. Connect to Git provider
4. Configure build:
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Root directory**: `/`
5. Click "Save and Deploy"

#### Via Wrangler CLI

```bash
# Install Wrangler
npm i -g wrangler

# Build
npm run build

# Deploy
wrangler pages publish dist
```

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

Next168 is a fully client-side application with no backend dependencies.

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

- [ ] `index.html` has correct title: "Next168 - Master your next 168 hours"
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

Next168 is built with performance in mind:
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

**Next168** - Plan your next 168 hours, effortlessly.

🌐 [next168.app](https://next168.app)
