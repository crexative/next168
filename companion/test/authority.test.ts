// Tasks P1-8 on the companion's real build graph (its esbuild metafile, the options of build.mjs): no companion module
// reaches the person's own commit module. The app's graph is checked by config/authorityGraph.spec.ts.
import { describe, expect, it } from 'vitest'
import { authorityViolations, companionGraph, PERSON_ACTIONS, repositoryRoot } from '../../config/authorityGraph'

const root = repositoryRoot()

describe('P1-8: the companion never reaches the person commit', () => {
  it('the companion graph holds the companion and never the module', async () => {
    const graph = await companionGraph(root)
    expect([...graph.keys()]).toContain('companion/src/mcp.ts')
    expect(graph.has(PERSON_ACTIONS)).toBe(false)
    expect(authorityViolations(graph)).toEqual([])
  }, 60_000)

  it('a companion module importing it is caught', async () => {
    const outcome = await companionGraph(root, { 'companion/src/mutation.ts': "import { addCapturedTasks } from '../../src/features/tasks/personActions'\nexport const run = addCapturedTasks\n" })
      .then((graph) => authorityViolations(graph), (error: Error) => [`build failed: ${error.message.split('\n')[0]}`])
    expect(outcome).not.toEqual([])
  }, 60_000)
})
