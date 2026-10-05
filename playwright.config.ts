import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  outputDir: '../headless-evidence',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['json', { outputFile: '../headless-results.json' }]],
  use: {
    baseURL: 'http://127.0.0.1:4186/next168/',
    browserName: 'chromium',
    headless: true,
    locale: 'en-US',
    timezoneId: 'Europe/London',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop-headless', use: { viewport: { width: 1280, height: 900 } } },
    { name: 'mobile-emulated-headless', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4186 --strictPort',
    url: 'http://127.0.0.1:4186/next168/',
    reuseExistingServer: false,
  },
})
