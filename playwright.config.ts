import { existsSync } from 'node:fs'
import { defineConfig, devices, webkit } from '@playwright/test'
import { previewPorts } from './e2e/support/ports'

const { root: ROOT_PORT, subpath: SUBPATH_PORT, server: SERVER_PORT } = previewPorts()
// A well-formed but fake Google OAuth client ID: the e2e build ships the Google Calendar code, and every Google
// request is answered by e2e/support/googleCalendar.ts.
const E2E_GOOGLE_CLIENT_ID = '000000000000-e2etest.apps.googleusercontent.com'

// CI installs WebKit; locally the project is skipped when the browser is not installed.
const webkitInstalled = existsSync(webkit.executablePath())

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/.results',
  fullyParallel: true,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'e2e/.report' }]],
  use: {
    baseURL: `http://127.0.0.1:${ROOT_PORT}/`,
    locale: 'en-US',
    timezoneId: 'UTC',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'tablet', use: { ...devices['Desktop Chrome'], viewport: { width: 768, height: 1024 } } },
    { name: 'phone', use: { ...devices['Desktop Chrome'], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true } },
    ...(webkitInstalled
      ? [{
          name: 'webkit-phone',
          grep: /@smoke/,
          use: { ...devices['iPhone 13'], viewport: { width: 375, height: 812 } },
        }]
      : []),
  ],
  webServer: [
    {
      command: `VITE_E2E=1 VITE_GOOGLE_CLIENT_ID=${E2E_GOOGLE_CLIENT_ID} npm run build && npm run preview -- --port ${ROOT_PORT} --strictPort`,
      url: `http://127.0.0.1:${ROOT_PORT}/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      // The same app built as the Weeklid-server client (VITE_GOOGLE_SERVER=1) with the accounts flag on (VITE_ACCOUNTS=1), in its
      // own output folder; the Google server routes are answered by e2e/support/googleServer.ts. The accounts routes are not
      // answered: a signed-out device must never call them (e2e/accounts-free-tier.spec.ts).
      command: `VITE_E2E=1 VITE_GOOGLE_CLIENT_ID=${E2E_GOOGLE_CLIENT_ID} VITE_GOOGLE_SERVER=1 VITE_ACCOUNTS=1 npm run build-only -- --outDir dist-server --emptyOutDir && npm run preview -- --outDir dist-server --port ${SERVER_PORT} --strictPort`,
      url: `http://127.0.0.1:${SERVER_PORT}/`,
      reuseExistingServer: false,
      timeout: 180_000,
    },
    {
      command: `npm run preview -- --port ${SUBPATH_PORT} --strictPort --base /next168/`,
      url: `http://127.0.0.1:${SUBPATH_PORT}/next168/`,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
})
