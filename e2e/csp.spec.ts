import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { seedKey, V2_KEY, TABS, openTab } from './fixtures'
import { onboardedDocument } from './support/seed'

// The page ships a Content Security Policy (index.html). Every feature must keep working under it: this walks the
// app with a violation listener installed before any script runs and expects it to stay silent.

type Violation = { directive: string; blocked: string; source: string; sample: string }

async function recordViolations(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const violations: unknown[] = []
    Object.assign(window, { __cspViolations: violations })
    document.addEventListener('securitypolicyviolation', (event) => {
      violations.push({ directive: event.violatedDirective, blocked: event.blockedURI, source: event.sourceFile, sample: event.sample })
    })
  })
}

async function violations(page: Page): Promise<Violation[]> {
  return page.evaluate(() => (window as unknown as { __cspViolations: Violation[] }).__cspViolations)
}

const categories = [
  { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } },
  { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } },
]
const blocks = [
  { id: 'b-sleep', categoryId: 'c-sleep', title: 'Night sleep', days: [0, 1, 2, 3, 4, 5, 6], start: 1380, end: 420 },
  { id: 'b-work', categoryId: 'c-work', title: 'Deep work', days: [1, 2, 3, 4, 5], start: 540, end: 1020 },
]

test.use({ launchOptions: { args: ['--disable-features=WebGPU'] } })

test.describe('Content Security Policy', () => {
  test.beforeEach(async ({ page }) => {
    await recordViolations(page)
    await seedKey(page, V2_KEY, JSON.stringify(onboardedDocument({ categories, blocks })))
  })

  test('the served page carries the policy and no inline script', async ({ page, request }) => {
    const response = await request.get('./')
    const html = await response.text()
    const policy = /<meta http-equiv="Content-Security-Policy" content="([^"]*)">/.exec(html)?.[1]
    expect(policy).toContain("script-src 'self' 'wasm-unsafe-eval'")
    const inline = [...html.matchAll(/<script\b(?![^>]*\bsrc=)[^>]*>/g)]
    expect(inline).toHaveLength(0)
    await page.goto('./')
    await expect(page.locator('meta[http-equiv="Content-Security-Policy"]')).toHaveCount(1)
    expect(await violations(page)).toEqual([])
  })

  test('the pre-paint script still sets the theme and the language', async ({ page }) => {
    await page.addInitScript(() => { try { localStorage.setItem('next168-appearance', 'dark'); localStorage.setItem('next168-language', 'fr') } catch { /* blocked */ } })
    // Without the app bundle, only prepaint.js can have set them.
    await page.route('**/assets/index-*.js', (route) => route.abort())
    await page.goto('./')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveAttribute('lang', 'fr')
    expect(await violations(page)).toEqual([])
  })

  test('every tab renders translated text with zero violations', async ({ page }) => {
    for (const tab of TABS) {
      await openTab(page, tab)
      expect(await page.locator('body').innerText(), tab).not.toMatch(/\b[a-z]{3,}\.[a-zA-Z]+\.[a-zA-Z]+\b/)
    }
    expect(await violations(page)).toEqual([])
  })

  test('the assistant, the any-AI panel and the share sheet raise no violation', async ({ page }) => {
    await page.goto('./#/assistant')
    await expect(page.getByRole('heading', { level: 1, name: 'Assistant' })).toBeVisible()
    await page.getByRole('button', { name: /Use with your AI/ }).click()
    await expect(page.getByTestId('any-ai-copy')).toBeVisible()
    await page.getByTestId('any-ai-copy').click()
    await openTab(page, 'insights')
    await page.getByRole('button', { name: 'Share my typical week' }).click()
    await expect(page.getByRole('dialog', { name: 'Share my typical week' })).toBeVisible()
    await expect(page.getByTestId('share-primary')).toBeEnabled()
    await expect(page.getByTestId('share-preview')).toBeVisible()
    expect(await violations(page)).toEqual([])
  })

  test('what the on-device assistant needs stays allowed: WebAssembly, blob workers, data and blob images', async ({ page }) => {
    await page.goto('./')
    const outcome = await page.evaluate(async () => {
      const empty = new Uint8Array([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0])
      await WebAssembly.instantiate(empty)
      const workerUrl = URL.createObjectURL(new Blob(['postMessage("up")'], { type: 'text/javascript' }))
      const fromWorker = await new Promise((resolve, reject) => {
        const worker = new Worker(workerUrl)
        worker.onmessage = (event) => resolve(event.data)
        worker.onerror = () => reject(new Error('worker failed'))
      })
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
      const decode = async (src: string) => { const image = new Image(); image.src = src; await image.decode(); return image.naturalWidth }
      const blobUrl = URL.createObjectURL(new Blob([Uint8Array.from(atob(png.split(',')[1]!), (c) => c.charCodeAt(0))], { type: 'image/png' }))
      return { fromWorker, data: await decode(png), blob: await decode(blobUrl) }
    })
    expect(outcome).toEqual({ fromWorker: 'up', data: 1, blob: 1 })
    expect(await violations(page)).toEqual([])
  })

  test('the policy is enforced: an injected inline script does not run', async ({ page }) => {
    await page.goto('./')
    await page.evaluate(() => {
      const script = document.createElement('script')
      script.textContent = 'window.__injected = true'
      document.head.append(script)
    })
    expect(await page.evaluate(() => (window as unknown as { __injected?: boolean }).__injected)).toBeUndefined()
    const seen = await violations(page)
    expect(seen.map((item) => item.directive)).toEqual(['script-src-elem'])
  })
})

test('the production build keeps the policy that index.html declares', () => {
  const source = readFileSync('index.html', 'utf8')
  const built = readFileSync('dist/index.html', 'utf8')
  const tag = (html: string) => /<meta http-equiv="Content-Security-Policy" content="[^"]*">/.exec(html)?.[0]
  expect(tag(built)).toBe(tag(source))
})
