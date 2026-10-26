import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'
import type { Page } from '@playwright/test'

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.wasm': 'application/wasm', '.txt': 'text/plain',
}

export interface TwoBuilds {
  origin(host?: '127.0.0.1' | 'localhost'): string
  // Serves `dist` at /old/ from now on: the same URL now delivers the new build, as an update would.
  serveAtOld(dist: string): void
  close(): Promise<void>
}

async function file(root: string, path: string): Promise<string> {
  const candidate = normalize(join(root, path))
  if (!candidate.startsWith(root)) return join(root, 'index.html')
  try {
    if ((await stat(candidate)).isFile()) return candidate
  } catch { /* Not a file: the app's own routes fall back to its page. */ }
  return join(root, 'index.html')
}

// One static server, two mounts on one origin: the new build at / and the pre-fence build at /old/.
// `/blank.html` is an empty page of the origin, for seeding storage before any build opens it.
export async function serveTwoBuilds(port: number, newDist: string, oldDist: string): Promise<TwoBuilds> {
  let old = oldDist
  const server: Server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://x').pathname)
    const send = async () => {
      if (path === '/blank.html') {
        response.writeHead(200, { 'Content-Type': TYPES['.html']!, 'Cache-Control': 'no-store' })
        return response.end('<!doctype html><title>blank</title>')
      }
      const [root, rest] = path === '/old' || path.startsWith('/old/') ? [old, path.slice('/old'.length) || '/'] : [newDist, path]
      const target = await file(root, rest)
      response.writeHead(200, { 'Content-Type': TYPES[extname(target)] ?? 'application/octet-stream', 'Cache-Control': 'no-store' })
      response.end(await readFile(target))
    }
    send().catch((error: unknown) => { response.writeHead(500); response.end(String(error)) })
  })
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  return {
    origin: (host = '127.0.0.1') => `http://${host}:${port}`,
    serveAtOld: (dist) => { old = dist },
    close: () => {
      server.closeAllConnections()
      return new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())))
    },
  }
}

export interface DatabaseDump { versions: Record<string, number>; hash: string; json?: string }

// A canonical dump of every IndexedDB database of the page's origin: versions, and a SHA-256 of every record
// (key and value) of every store. Opening without a version never upgrades or creates anything.
export async function dumpOrigin(page: Page, withJson = false): Promise<DatabaseDump> {
  return page.evaluate(async (includeJson) => {
    const request = <T>(make: () => IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      const pending = make()
      pending.onsuccess = () => resolve(pending.result)
      pending.onerror = () => reject(pending.error)
    })
    const names = (await indexedDB.databases()).map((database) => database.name!).sort()
    const dump: Record<string, unknown> = {}
    const versions: Record<string, number> = {}
    for (const name of names) {
      const db = await request(() => indexedDB.open(name))
      const stores: Record<string, unknown> = {}
      for (const store of Array.from(db.objectStoreNames).sort()) {
        const transaction = db.transaction(store, 'readonly')
        const keys = await request(() => transaction.objectStore(store).getAllKeys())
        const values = await request(() => transaction.objectStore(store).getAll())
        stores[store] = keys.map((key, index) => [key, values[index]])
      }
      versions[name] = db.version
      dump[name] = { version: db.version, stores }
      db.close()
    }
    const json = JSON.stringify(dump)
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json))
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    return { versions, hash, ...(includeJson ? { json } : {}) }
  }, withJson)
}

export interface VersionOneData {
  document: string
  backup?: string
  proposals?: string
  texts: Record<string, string>
}

// Writes the pre-fence storage layout at version 1, exactly as the pre-fence build creates and fills it.
export async function seedVersionOne(page: Page, data: VersionOneData): Promise<void> {
  await page.evaluate(async ({ document, backup, proposals, texts }) => {
    const open = (name: string, stores: string[]) => new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name, 1)
      request.onupgradeneeded = () => { for (const store of stores) request.result.createObjectStore(store) }
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => reject(request.error)
    })
    const write = (db: IDBDatabase, stores: string[], fill: (transaction: IDBTransaction) => void) => new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(stores, 'readwrite')
      fill(transaction)
      transaction.oncomplete = () => { db.close(); resolve() }
      transaction.onabort = () => reject(transaction.error)
    })
    const planner = await open('next168', ['document', 'backup', 'proposals', 'meta'])
    await write(planner, ['document', 'backup', 'proposals'], (transaction) => {
      transaction.objectStore('document').put(document, 'current')
      if (backup !== undefined) transaction.objectStore('backup').put(backup, 'current')
      if (proposals !== undefined) transaction.objectStore('proposals').put(proposals, 'all')
    })
    const calendars = await open('next168-calendars', ['sources'])
    await write(calendars, ['sources'], (transaction) => {
      for (const [id, text] of Object.entries(texts)) transaction.objectStore('sources').put(text, id)
    })
  }, data)
}

// The stored planner and every calendar text it references, read without opening at a version.
export async function storedPlan(page: Page): Promise<{ document: string; texts: Record<string, string> }> {
  return page.evaluate(async () => {
    const request = <T>(make: () => IDBRequest<T>) => new Promise<T>((resolve, reject) => {
      const pending = make()
      pending.onsuccess = () => resolve(pending.result)
      pending.onerror = () => reject(pending.error)
    })
    const planner = await request(() => indexedDB.open('next168'))
    const document = await request(() => planner.transaction('document').objectStore('document').get('current')) as string
    planner.close()
    const calendars = await request(() => indexedDB.open('next168-calendars'))
    const texts: Record<string, string> = {}
    for (const source of JSON.parse(document).calendarSources as { id: string }[]) {
      texts[source.id] = await request(() => calendars.transaction('sources').objectStore('sources').get(source.id)) as string
    }
    calendars.close()
    return { document, texts }
  })
}
