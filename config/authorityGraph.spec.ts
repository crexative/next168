// @vitest-environment node
// Tasks P1-8 (design rev 6 §2.4, addendum 6.1 F4): the person-authority boundary on the real build graphs, and the
// mutations that must each break it. The companion's graph is checked by the companion suite
// (companion/test/authority.test.ts), which installs the companion's own esbuild.
import { beforeAll, describe, expect, it } from 'vitest'
import { appGraph, authorityViolations, PERSON_ACTIONS, repositoryRoot, type ModuleGraph } from './authorityGraph'

const root = repositoryRoot()
let app: ModuleGraph
let personExports: Set<string>
beforeAll(async () => {
  app = await appGraph(root)
  personExports = app.get(PERSON_ACTIONS)!.exports
}, 120_000)

describe('P1-8: only person UI reaches the person commit', () => {
  it('the app graph holds the module and the boundary, and nothing crosses it', () => {
    expect([...personExports]).toEqual(expect.arrayContaining(['commitPersonOps', 'addCapturedTasks']))
    expect([...app.keys()].some((path) => path.startsWith('src/features/assistant/'))).toBe(true)
    expect([...app.keys()].some((path) => path.startsWith('src/features/proposals/'))).toBe(true)
    expect(authorityViolations(app)).toEqual([])
  })
})

describe('P1-8: each way around the boundary is caught', () => {
  const mutations: [string, Record<string, string>][] = [
    ['an assistant helper reaches it through import.meta.glob', {
      'src/features/assistant/mutationGlob.ts': "const modules = import.meta.glob('../tasks/personActions.ts', { eager: true })\nexport const count = Object.keys(modules).length\n",
    }],
    ['a proposal module imports it in a Vue SFC <script setup>', {
      'src/features/proposals/MutationSheet.vue': "<script setup lang=\"ts\">\nimport { addCapturedTasks } from '@/features/tasks/personActions'\nconst run = addCapturedTasks\n</script>\n<template><button @click=\"run\">x</button></template>\n",
    }],
    ['an assistant module reaches it through a shared helper that re-exports it', {
      'src/ui/mutationShared.ts': "export { addCapturedTasks } from '@/features/tasks/personActions'\n",
      'src/features/assistant/mutationViaShared.ts': "import { addCapturedTasks } from '@/ui/mutationShared'\nexport const run = addCapturedTasks\n",
    }],
    ['a literal dynamic import from an assistant module', {
      'src/features/assistant/mutationDynamic.ts': "export const load = () => import('../tasks/personActions')\n",
    }],
  ]
  // One build holds every mutation; each must produce its own violation (they are told apart by the module that starts it).
  let mutated: string[]
  beforeAll(async () => {
    mutated = authorityViolations(await appGraph(root, Object.assign({}, ...mutations.map(([, overlay]) => overlay))), personExports)
  }, 120_000)
  const expected: Record<string, RegExp[]> = {
    'an assistant helper reaches it through import.meta.glob': [/^src\/features\/assistant\/mutationGlob\.ts reaches/],
    'a proposal module imports it in a Vue SFC <script setup>': [/^src\/features\/proposals\/MutationSheet\.vue reaches/],
    'an assistant module reaches it through a shared helper that re-exports it': [/^src\/features\/assistant\/mutationViaShared\.ts reaches .* -> src\/ui\/mutationShared\.ts -> /, /^src\/ui\/mutationShared\.ts re-exports addCapturedTasks/],
    'a literal dynamic import from an assistant module': [/^src\/features\/assistant\/mutationDynamic\.ts reaches/],
  }
  for (const [name] of mutations) {
    it(name, () => {
      for (const pattern of expected[name]!) expect([name, mutated.some((violation) => pattern.test(violation))]).toEqual([name, true])
    })
  }

  it('a computed import() anywhere in src fails the build', async () => {
    await expect(appGraph(root, { 'src/ui/mutationComputed.ts': "export const load = (name: string) => import(name)\n" })).rejects.toThrow(/non-literal dynamic import/)
  }, 120_000)
})
