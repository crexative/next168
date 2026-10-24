// A1 gate: does a change that the installed app shows survive `am force-stop com.android.chrome`?
// Drives the installed PWA on an Android emulator through Chrome DevTools over adb. Not a Playwright spec.
//
// Prerequisites (see docs/architecture/deliverable-1.md, Revision 4):
//   emulator booted; `adb -s <serial> reverse tcp:<port> tcp:<port>`; the build under test served on that port;
//   the app installed from Chrome (menu > Install) with its home-screen icon (see A1_ICON_INDEX).
// Environment:
//   A1_SERIAL      emulator serial (default emulator-5554); anything that is not an emulator is refused
//   A1_ORIGIN      origin of the installed app (default http://localhost:4610)
//   A1_ICON_INDEX  which "Next168" home-screen icon is the app under test, counting from 0 in launcher order
//                  (an emulator can hold shortcuts from other origins; default 0)
//   A1_CDP_PORT    local port forwarded to chrome_devtools_remote (default 4611)
//   A1_OUT         directory for screenshots and the JSON log
//   A1_LABEL       label recorded in the log (for example baseline-fae1754 or candidate-<sha>)
//   A1_ITERATIONS  comma-separated subset of 1..5 (default all)
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const serial = process.env.A1_SERIAL ?? 'emulator-5554'
if (!serial.startsWith('emulator-')) throw new Error(`A1 runs only on an emulator, refusing serial ${serial}`)
const origin = process.env.A1_ORIGIN ?? 'http://localhost:4610'
const iconIndex = Number(process.env.A1_ICON_INDEX ?? 0)
const cdpPort = Number(process.env.A1_CDP_PORT ?? 4611)
const out = process.env.A1_OUT ?? join(process.cwd(), 'e2e/.results/android')
const label = process.env.A1_LABEL ?? 'unlabelled'
const iterations = (process.env.A1_ITERATIONS ?? '1,2,3,4,5').split(',').map(Number)
const adbPath = join(homedir(), 'Library/Android/sdk/platform-tools/adb')
const runId = Date.now()

mkdirSync(out, { recursive: true })
const log = { label, serial, origin, runId, chrome: '', iterations: [] }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const adb = (...args) => execFileSync(adbPath, ['-s', serial, ...args], { encoding: 'utf8' })
const stamp = () => new Date().toISOString()
const say = (...parts) => console.log(stamp(), ...parts)

async function connect() {
  adb('forward', `tcp:${cdpPort}`, 'localabstract:chrome_devtools_remote')
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cdpPort}`)
      const page = browser.contexts().flatMap((context) => context.pages()).find((candidate) => candidate.url().startsWith(origin))
      if (page) return { browser, page }
      await browser.close()
    } catch { /* Chrome is still starting. */ }
    await sleep(1000)
  }
  throw new Error(`no page for ${origin} over CDP`)
}

function launcherIcons() {
  adb('shell', 'uiautomator', 'dump', '/sdcard/a1-launcher.xml')
  const xml = adb('exec-out', 'cat', '/sdcard/a1-launcher.xml')
  return [...xml.matchAll(/<node [^>]*content-desc="Next168"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/g)]
    .map(([, left, top, right, bottom]) => ({ x: (Number(left) + Number(right)) >> 1, y: (Number(top) + Number(bottom)) >> 1 }))
}

// Taps the installed app's icon: home page first, then one launcher page at a time to the right.
async function tapInstalledIcon() {
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
  await sleep(1000)
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
  await sleep(1500)
  for (let page = 0; page < 5; page++) {
    const icons = launcherIcons()
    if (icons.length > iconIndex) {
      adb('shell', 'input', 'tap', String(icons[iconIndex].x), String(icons[iconIndex].y))
      return
    }
    adb('shell', 'input', 'swipe', '900', '1200', '150', '1200', '300')
    await sleep(1200)
  }
  throw new Error('installed app icon not found on the launcher')
}

async function launchInstalledApp() {
  await tapInstalledIcon()
  const connection = await connect()
  await connection.page.getByRole('heading', { level: 1 }).first().waitFor({ timeout: 20_000 })
  const standalone = await connection.page.evaluate(() => matchMedia('(display-mode: standalone)').matches)
  if (!standalone) throw new Error('the app did not open in standalone mode; was it launched from the installed icon?')
  return connection
}

async function onboardIfAsked(page) {
  const dialog = page.getByRole('dialog', { name: 'Pick your categories' })
  if (!(await dialog.isVisible().catch(() => false))) return false
  await dialog.getByRole('checkbox', { name: 'Use Work' }).check()
  await dialog.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByTestId('onboarding').waitFor({ state: 'hidden' })
  return true
}

async function openWeek(page) {
  await page.getByRole('link', { name: 'Week' }).last().click()
  await page.getByRole('heading', { level: 1, name: 'Week' }).waitFor()
  await page.waitForFunction(() => document.getAnimations().length === 0, null, { timeout: 10_000 }).catch(() => undefined)
}

async function createBlock(page, title, hour) {
  await openWeek(page)
  await page.getByRole('button', { name: 'Add block' }).click()
  const dialog = page.getByRole('dialog', { name: 'New block' })
  await dialog.getByLabel('Title').fill(title)
  await dialog.getByLabel('Starts').fill(`${String(hour).padStart(2, '0')}:00`)
  await dialog.getByLabel('Ends').fill(`${String(hour).padStart(2, '0')}:30`)
  const started = performance.now()
  await dialog.getByRole('button', { name: 'Save' }).click()
  await dialog.waitFor({ state: 'hidden' })
  const saveMs = Math.round(performance.now() - started)
  await page.getByText(title).first().waitFor()
  return saveMs
}

async function deleteEverything(page) {
  await page.getByRole('link', { name: 'Settings' }).first().click()
  await page.getByRole('heading', { level: 1, name: 'Settings' }).waitFor()
  await page.getByRole('button', { name: 'Delete all data…' }).click()
  const dialog = page.getByRole('dialog', { name: 'Delete everything?' })
  await dialog.getByRole('textbox').fill('DELETE')
  await dialog.getByRole('button', { name: 'Delete everything' }).click()
  await page.getByTestId('data-notice').filter({ hasText: 'All data was deleted' }).waitFor()
}

// Diagnostic only (red-team #11): which backing store holds the planner in the build under test.
function storedSnapshot(page) {
  return page.evaluate(async () => {
    const legacy = localStorage.getItem('next168-v2')
    const databases = (await indexedDB.databases?.()) ?? []
    let indexedDbDocument = null
    if (databases.some((database) => database.name === 'next168')) {
      indexedDbDocument = await new Promise((resolve) => {
        const request = indexedDB.open('next168')
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('document')) { db.close(); resolve(null); return }
          const read = db.transaction('document').objectStore('document').get('current')
          read.onsuccess = () => { db.close(); resolve(read.result ?? null) }
          read.onerror = () => { db.close(); resolve(null) }
        }
        request.onerror = () => resolve(null)
      })
    }
    const summarize = (raw) => {
      if (raw === null) return null
      try {
        const document = JSON.parse(raw)
        return { revision: document.revision, blocks: document.blocks.map((block) => block.title) }
      } catch { return { unreadable: raw.slice(0, 80) } }
    }
    return { localStorageV2: summarize(legacy), indexedDbDocument: summarize(indexedDbDocument) }
  })
}

async function visibleKillTitles(page, onboardingShown) {
  // The first-run sheet only reappears when the planner was lost; it covers the tabs, so read what is shown.
  if (!onboardingShown) await openWeek(page)
  return page.evaluate(() => [...new Set((document.querySelector('main')?.innerText.match(/Kill-\d+-\d+/g)) ?? [])])
}

async function runIteration(iteration) {
  const entry = { iteration, startedAt: stamp() }
  let { browser, page } = await launchInstalledApp()
  entry.onboarded = await onboardIfAsked(page)
  const title = `Kill-${iteration}-${runId}`
  if (iteration === 5) {
    await deleteEverything(page)
    entry.action = 'delete-all'
  } else {
    entry.saveMs = await createBlock(page, title, iteration + 1)
    entry.action = `created ${title}`
  }
  entry.before = await storedSnapshot(page)
  await page.screenshot({ path: join(out, `${label}-it${iteration}-before.png`) })
  await sleep(2000)
  if (iteration === 4) {
    adb('shell', 'input', 'keyevent', 'KEYCODE_HOME')
    await sleep(1000)
  }
  await browser.close().catch(() => undefined)
  entry.forceStopAt = stamp()
  adb('shell', 'am', 'force-stop', 'com.android.chrome')
  await sleep(2000)
  ;({ browser, page } = await launchInstalledApp())
  entry.onboardingShownAfterRelaunch = await page.getByRole('dialog', { name: 'Pick your categories' }).isVisible().catch(() => false)
  entry.after = await storedSnapshot(page)
  const titles = await visibleKillTitles(page, entry.onboardingShownAfterRelaunch)
  entry.visibleKillTitles = titles
  entry.blockCount = entry.onboardingShownAfterRelaunch
    ? null
    : Number(await page.getByTestId('block-count').getAttribute('data-count', { timeout: 5000 }).catch(() => null))
  await page.screenshot({ path: join(out, `${label}-it${iteration}-after.png`) })
  // Iteration 5 also needs the reset itself to survive: a lost reset reopens on the first-run sheet.
  entry.pass = iteration === 5
    ? titles.length === 0 && entry.blockCount === 0 && !entry.onboardingShownAfterRelaunch
    : titles.includes(title)
  await browser.close().catch(() => undefined)
  say(`iteration ${iteration}:`, entry.pass ? 'PASS' : 'FAIL', JSON.stringify({ action: entry.action, titles, after: entry.after }))
  return entry
}

// Every run starts from an empty origin, so iteration 1 onboards through the UI like a new user.
async function resetOrigin() {
  const { browser, page } = await launchInstalledApp()
  const session = await page.context().newCDPSession(page)
  await session.send('Storage.clearDataForOrigin', { origin, storageTypes: 'local_storage,indexeddb' })
  await page.reload()
  await page.getByRole('dialog', { name: 'Pick your categories' }).waitFor({ timeout: 20_000 })
  await browser.close().catch(() => undefined)
  adb('shell', 'am', 'force-stop', 'com.android.chrome')
}

log.chrome = adb('shell', 'dumpsys', 'package', 'com.android.chrome').match(/versionName=(\S+)/)?.[1] ?? 'unknown'
say('A1', label, 'chrome', log.chrome, 'serial', serial)
adb('shell', 'am', 'force-stop', 'com.android.chrome')
await resetOrigin()
for (const iteration of iterations) {
  try {
    log.iterations.push(await runIteration(iteration))
  } catch (error) {
    log.iterations.push({ iteration, pass: false, error: error instanceof Error ? error.message : String(error) })
    say(`iteration ${iteration}: ERROR`, error instanceof Error ? error.message : error)
  }
  writeFileSync(join(out, `${label}.json`), `${JSON.stringify(log, null, 2)}\n`)
}
log.passed = log.iterations.filter((entry) => entry.pass).length
writeFileSync(join(out, `${label}.json`), `${JSON.stringify(log, null, 2)}\n`)
say(`A1 ${label}: ${log.passed}/${log.iterations.length} passed`)
process.exitCode = log.passed === log.iterations.length ? 0 : 1
