// @vitest-environment node
// P1 review F3: importing into an empty companion workspace replaces it (its generation moves forward), and the
// read-back must expect exactly that, or a successful import is reported as a failure. The companion's own Workspace
// does the import behind the two API routes this flow calls (the HTTP server itself is covered by the companion suite,
// whose dependencies the root checks do not install).
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { buildExportBundle, parseExportBundle } from '@/core/exportBundle'
import { testDocument } from '@/repositories/testSupport'
import { Workspace } from '../../../../companion/src/workspace'
import { importCompanionBundle } from './transfer'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const step of cleanup.splice(0).reverse()) await step()
})

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

it('a companion import of a generation-0 bundle verifies against the generation the companion stores', async () => {
  const home = await mkdtemp(join(tmpdir(), 'weeklid-transfer-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const workspace = new Workspace(home)
  await workspace.initialize()
  vi.stubGlobal('fetch', async (path: string, init: RequestInit = {}) => {
    if (path === '/api/document' && (init.method ?? 'GET') === 'GET') {
      const loaded = await workspace.load()
      return reply(200, loaded.kind === 'ok' ? { document: loaded.document } : loaded)
    }
    if (path === '/api/import' && init.method === 'POST') {
      const { bundle, expectedRevision } = JSON.parse(String(init.body)) as { bundle: unknown; expectedRevision: number }
      const parsed = parseExportBundle(JSON.stringify(bundle))
      if (parsed.kind !== 'ok') return reply(400, { error: 'invalid-export' })
      const saved = await workspace.importBundle(parsed.bundle, expectedRevision)
      return reply(saved.kind === 'conflict' ? 409 : 200, saved)
    }
    return reply(404, { error: 'api-not-found' })
  })

  const document = testDocument({ workspaceId: 'ws-imported', revision: 4, generation: 0, tasks: [{ id: 't-1', title: 'Pagar luz', priority: 2, createdAt: '2026-10-20T08:00:00.000Z' }] })
  const bundle = buildExportBundle(document, {}, { now: () => new Date('2026-10-26T12:00:00Z') })
  await expect(importCompanionBundle(JSON.stringify(bundle))).resolves.toBeUndefined()
  expect(await workspace.document()).toMatchObject({ workspaceId: 'ws-imported', generation: 1, tasks: [{ title: 'Pagar luz' }] })
})
