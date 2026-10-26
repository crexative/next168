// @vitest-environment node
// P1 review F3: importing into an empty companion workspace replaces it (its generation moves forward), and the
// read-back must expect exactly that, or a successful import is reported as a failure.
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { buildExportBundle } from '@/core/exportBundle'
import { testDocument } from '@/repositories/testSupport'
import { startCompanion } from '../../../../companion/src/server'
import { importCompanionBundle } from './transfer'

const cleanup: (() => Promise<unknown>)[] = []
afterEach(async () => {
  vi.unstubAllGlobals()
  for (const step of cleanup.splice(0).reverse()) await step()
})

it('a companion import of a generation-0 bundle verifies against the generation the companion stores', async () => {
  const home = await mkdtemp(join(tmpdir(), 'weeklid-transfer-'))
  cleanup.push(() => rm(home, { recursive: true, force: true }))
  const running = await startCompanion({ home, dist: home, port: 0 })
  cleanup.push(() => running.close())
  const paired = await fetch(`${running.url}/api/pair`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: running.pairingCode }) })
  const cookie = paired.headers.get('set-cookie')!.split(';')[0]!
  const realFetch = globalThis.fetch
  vi.stubGlobal('fetch', (path: string, init: RequestInit = {}) => realFetch(`${running.url}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: cookie } }))

  const document = testDocument({ workspaceId: 'ws-imported', revision: 4, generation: 0, tasks: [{ id: 't-1', title: 'Pagar luz', priority: 2, createdAt: '2026-10-20T08:00:00.000Z' }] })
  const bundle = buildExportBundle(document, {}, { now: () => new Date('2026-10-26T12:00:00Z') })
  await expect(importCompanionBundle(JSON.stringify(bundle))).resolves.toBeUndefined()
  const stored = await running.workspace.document()
  expect(stored).toMatchObject({ workspaceId: 'ws-imported', generation: 1, tasks: [{ title: 'Pagar luz' }] })
})
