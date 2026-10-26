import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Workspace } from '../src/workspace'
import { atomicWrite } from '../src/files'
import { buildExportBundle } from '../../src/core/exportBundle'
import { createEmptyDocument } from '../../src/core/documents'

const homes: string[] = []
afterEach(async () => { await Promise.all(homes.splice(0).map(home => rm(home, { recursive: true, force: true }))) })
async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'next168-test-')); homes.push(home)
  const workspace = new Workspace(home)
  await workspace.initialize()
  const loaded = await workspace.load()
  if (loaded.kind !== 'ok') throw Error('fixture')
  const document = loaded.document
  document.categories.push({ id: 'focus', name: 'Focus', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } })
  document.revision++
  await workspace.save(document, 0)
  const input = { contractVersion: '1.1' as const, workspaceId: document.workspaceId, baseRevision: 1, summary: 'Focus time', ops: [{ op: 'add_block' as const, block: { categoryId: 'focus', title: 'Deep focus', days: [1], start: 540, end: 600 } }] }
  return { home, workspace, document, input }
}
describe('serialized workspace commits', () => {
  it.each(['pairing', 'proposal'])('leaves browser language selection open after %s', async (path) => {
    const home = await mkdtemp(join(tmpdir(), 'next168-locale-')); homes.push(home)
    const workspace = new Workspace(home)
    await workspace.initialize()
    const document = await workspace.document()
    if (path === 'proposal') {
      const proposal = await workspace.create({ contractVersion: '1.1', workspaceId: document.workspaceId, baseRevision: 0, summary: 'Read', ops: [{ op: 'add_task', task: { title: 'Read', durationMin: 15, priority: 1 } }] }, 'mcp')
      await workspace.approve(proposal.id, proposal.contentHash, 0)
    }
    expect((await workspace.document()).settings.locale).toBe('und')
  })
  it('commits concurrent approvals once and replays the recorded revision', async () => {
    const { workspace, input } = await setup()
    const proposal = await workspace.create(input, 'mcp')
    const results = await Promise.all(Array.from({ length: 8 }, () => workspace.approve(proposal.id, proposal.contentHash, 1)))
    expect(results).toEqual(Array(8).fill({ kind: 'applied', revision: 2 }))
    const loaded = await workspace.load()
    expect(loaded.kind === 'ok' && loaded.document.blocks).toHaveLength(1)
  })
  it('recovers after document commit but before proposal status commit', async () => {
    const { home, workspace, input } = await setup()
    const proposal = await workspace.create(input, 'mcp')
    const pending = await readFile(join(home, 'proposals.v3.json'), 'utf8')
    await workspace.approve(proposal.id, proposal.contentHash, 1)
    await writeFile(join(home, 'proposals.v3.json'), pending)
    const restarted = new Workspace(home)
    expect(await restarted.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'applied', revision: 2 })
    const loaded = await restarted.load()
    expect(loaded.kind === 'ok' && loaded.document.blocks).toHaveLength(1)
  })
  it('rejects stale revisions, wrong workspace and changed approval bindings', async () => {
    const { workspace, input, document } = await setup()
    await expect(workspace.create({ ...input, workspaceId: 'other' }, 'mcp')).rejects.toThrow('Workspace')
    const proposal = await workspace.create(input, 'mcp')
    await expect(workspace.approve(proposal.id, 'wrong', 1)).rejects.toThrow('hash')
    await workspace.save({ ...document, revision: 2 }, 1)
    expect(await workspace.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'stale', currentRevision: 2 })
    expect(await workspace.save({ ...document, revision: 2 }, 1)).toEqual({ kind: 'conflict', currentRevision: 2 })
  })
  it('leaves corrupt primary untouched and offers a validated backup', async () => {
    const { home, workspace } = await setup()
    await writeFile(join(home, 'planner.json'), '{broken')
    await workspace.initialize()
    expect((await workspace.load()).kind).toBe('corrupt')
    expect(await readFile(join(home, 'planner.json'), 'utf8')).toBe('{broken')
    expect(await workspace.backup()).toBeDefined()
    await expect(workspace.save(createEmptyDocument({ now: new Date(), locale: 'en', timeZone: 'UTC' }), 0)).rejects.toThrow('unreadable')
  })
  it('preserves previous bytes on a crash before rename and reports post-rename uncertainty', async () => {
    const { home } = await setup()
    const file = join(home, 'fault.json')
    await atomicWrite(file, 'previous')
    await expect(atomicWrite(file, 'candidate', { beforeRename: () => { throw Error('crash') } })).rejects.toThrow('crash')
    expect(await readFile(file, 'utf8')).toBe('previous')
    expect(await atomicWrite(file, 'committed', { syncDirectory: async () => { throw Error('disk') } })).toEqual({ warning: 'durability-unknown' })
    expect(await readFile(file, 'utf8')).toBe('committed')
    expect(await readFile(`${file}.bak`, 'utf8')).toBe('previous')
  })
  it('repairs the original applied revision even after an intervening content save', async () => {
    const { home, workspace, input } = await setup()
    const proposal = await workspace.create(input, 'mcp')
    const pending = await readFile(join(home, 'proposals.v3.json'), 'utf8')
    await workspace.approve(proposal.id, proposal.contentHash, 1)
    const document = await workspace.document()
    await workspace.save({ ...document, revision: 3 }, 2)
    await writeFile(join(home, 'proposals.v3.json'), pending)
    expect(await workspace.approve(proposal.id, proposal.contentHash, 1)).toEqual({ kind: 'applied', revision: 2 })
    expect((await workspace.document()).revision).toBe(3)
    expect((await workspace.document()).blocks).toHaveLength(1)
  })
  it('serializes competing bundle imports and never overwrites the winning calendar text', async () => {
    const home = await mkdtemp(join(tmpdir(), 'next168-import-')); homes.push(home)
    const workspace = new Workspace(home); await workspace.initialize()
    const makeBundle = (name: string) => {
      const document = createEmptyDocument({ now: new Date(), locale: 'en', timeZone: 'UTC', idGen: () => name })
      document.calendarSources.push({ id: 'shared', name, kind: 'file', colorKey: 'blue' })
      return buildExportBundle(document, { shared: name }, { now: () => new Date() })
    }
    const results = await Promise.all([workspace.importBundle(makeBundle('first'), 0), workspace.importBundle(makeBundle('second'), 0)])
    expect(results).toEqual([{ kind: 'ok', revision: 1 }, { kind: 'conflict', currentRevision: 1 }])
    expect((await workspace.document()).workspaceId).toBe('first')
    expect(await readFile(join(home, 'calendars/shared.ics'), 'utf8')).toBe('first')
  })
  it('restores backup only after an explicit request and preserves it during recovery', async () => {
    const { workspace, home } = await setup()
    const originalBackup = await readFile(join(home, 'planner.json.bak'), 'utf8')
    await writeFile(join(home, 'planner.json'), 'corrupt')
    expect(await workspace.restoreBackup()).toEqual({ kind: 'ok', revision: 0 })
    expect(await readFile(join(home, 'planner.json.bak'), 'utf8')).toBe(originalBackup)
    expect((await workspace.load()).kind).toBe('ok')
  })

  it('keeps a valid primary after actual child-process termination before rename', async () => {
    const { home, workspace, document } = await setup()
    const child = join(home, 'crash.mjs')
    await build({ stdin: { contents: "import { atomicWrite } from './src/files.ts'; await atomicWrite(process.argv[2], process.argv[3], { beforeRename: () => process.exit(51) })", resolveDir: process.cwd(), sourcefile: 'crash.ts' }, outfile: child, bundle: true, platform: 'node', format: 'esm' })
    const result = spawnSync(process.execPath, [child, join(home, 'planner.json'), JSON.stringify({ ...document, revision: 2 })])
    expect(result.status).toBe(51)
    expect((await workspace.document()).revision).toBe(1)
    expect(JSON.parse(await readFile(join(home, 'planner.json.bak'), 'utf8')).revision).toBe(1)
  })

  it('allows only one of two different proposals on the same base to commit', async () => {
    const { workspace, input } = await setup()
    const first = await workspace.create(input, 'mcp')
    const second = await workspace.create({ ...input, summary: 'Alternative focus time' }, 'mcp')
    expect(await Promise.all([workspace.approve(first.id, first.contentHash, 1), workspace.approve(second.id, second.contentHash, 1)])).toEqual([{ kind: 'applied', revision: 2 }, { kind: 'stale', currentRevision: 2 }])
    expect((await workspace.document()).blocks).toHaveLength(1)
  })

  it('repairs pending status when rejection finds an already committed proposal', async () => {
    const { home, workspace, input } = await setup()
    const proposal = await workspace.create(input, 'mcp')
    const pending = await readFile(join(home, 'proposals.v3.json'), 'utf8')
    await workspace.approve(proposal.id, proposal.contentHash, 1)
    await writeFile(join(home, 'proposals.v3.json'), pending)
    expect(await workspace.reject(proposal.id)).toEqual({ kind: 'applied', revision: 2 })
    expect(await workspace.list('pending')).toHaveLength(0)
    expect((await workspace.document()).blocks).toHaveLength(1)
  })

})
