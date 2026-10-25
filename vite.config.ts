import { fileURLToPath, URL } from 'node:url'

import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import { VitePWA } from 'vite-plugin-pwa'
import { readPreviewHttps } from './config/lanHttps'
import { validatePublicUrl } from './config/publicUrl'

const BRAND_TINT = '#5856D6'
const GROUPED_BACKGROUND = '#F2F2F7'
const MAX_PRECACHE_BYTES = 5 * 1024 * 1024

// A configured public address must be a public HTTPS page; anything else (a LAN address, localhost, a token in the
// query) fails the build instead of being printed on shared images.
function checkPublicUrl(mode: string): void {
  const raw = loadEnv(mode, process.cwd(), 'VITE_').VITE_PUBLIC_URL
  if (!raw) return
  const result = validatePublicUrl(raw)
  if (!result.ok) throw new Error(`VITE_PUBLIC_URL "${raw}" is not a public address: ${result.reason}`)
}

// base './' lets the same build run at '/', at '/next168/' and inside the local companion.
export default defineConfig(({ isPreview, mode }) => {
  checkPublicUrl(mode)
  return {
    base: './',
    plugins: [
      vue(),
      VitePWA({
        registerType: 'prompt',
        injectRegister: false,
        includeAssets: ['favicon.ico', 'apple-touch-icon-180x180.png'],
        manifest: {
          name: 'Next168',
          short_name: 'Next168',
          description: 'Plan your 168 hours. Local-first weekly planner.',
          display: 'standalone',
          start_url: './',
          scope: './',
          theme_color: BRAND_TINT,
          background_color: GROUPED_BACKGROUND,
          icons: [
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            { src: 'maskable-icon-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
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
  }
})
