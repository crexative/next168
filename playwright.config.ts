import { existsSync } from 'node:fs'
import { defineConfig, devices, webkit } from '@playwright/test'
import { previewPorts } from './e2e/support/ports'

const { root: ROOT_PORT, subpath: SUBPATH_PORT } = previewPorts()

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
      command: `VITE_E2E=1 npm run build && npm run preview -- --port ${ROOT_PORT} --strictPort`,
      url: `http://127.0.0.1:${ROOT_PORT}/`,
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
