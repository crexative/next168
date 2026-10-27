import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv, type ConfigEnv, type UserConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { readPreviewHttps } from './config/lanHttps'
import { assertPublicUrl } from './config/publicUrl'

// The installed window's bars match the page's grouped background, as the theme-color metas in index.html do
// (src/ui/appearance.ts): the brand green lives in the icon and the controls, not in the system chrome.
const GROUPED_BACKGROUND = '#F2F2F7'
const MAX_PRECACHE_BYTES = 5 * 1024 * 1024

// A configured public address must be a public HTTPS page; anything else (a LAN address, localhost, a token in the
// query) fails the build instead of being printed on shared images.
function checkPublicUrl(mode: string): void {
  const raw = loadEnv(mode, process.cwd(), 'VITE_').VITE_PUBLIC_URL
  if (raw) assertPublicUrl(raw)
}

// base './' lets the same build run at '/', at '/next168/' and inside the local companion.
const appConfig = ({ isPreview }: ConfigEnv): UserConfig => ({
  base: './',
  // vue-i18n compiles each message with `new Function` unless JIT is on, which the page's Content Security Policy
  // (index.html, no 'unsafe-eval') would block; the JIT build interprets the message tree instead.
  define: { __INTLIFY_JIT_COMPILATION__: true },
  plugins: [
    vue(),
    VitePWA({
      registerType: 'prompt',
      injectRegister: false,
      includeAssets: ['favicon.ico', 'favicon.svg', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon-180x180.png'],
      manifest: {
        name: 'Weeklid',
        short_name: 'Weeklid',
        description: 'Plan your 168 hours. Local-first weekly planner.',
        display: 'standalone',
        start_url: './',
        scope: './',
        theme_color: GROUPED_BACKGROUND,
        background_color: GROUPED_BACKGROUND,
        icons: [
          { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          { src: 'monochrome-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'monochrome' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        globIgnores: ['**/webllm*.js'],
        maximumFileSizeToCacheInBytes: MAX_PRECACHE_BYTES,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/\/api\//],
        clientsClaim: true,
        runtimeCaching: [
          { urlPattern: ({ url }) => url.pathname.includes('/api/'), handler: 'NetworkOnly' },
          // The optional on-device assistant is about 12 MB of code: cached on first use, never precached.
          { urlPattern: ({ url }) => /\/assets\/webllm[^/]*\.js$/.test(url.pathname), handler: 'CacheFirst', options: { cacheName: 'next168-assistant-code' } },
        ],
      },
    }),
  ],
  build: {
    rollupOptions: {
      output: { manualChunks: (id) => (id.includes('/node_modules/@mlc-ai/web-llm/') ? 'webllm' : undefined) },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    https: isPreview ? readPreviewHttps(process.env) : undefined,
  },
})

export default defineConfig((env) => {
  checkPublicUrl(env.mode)
  return appConfig(env)
})
