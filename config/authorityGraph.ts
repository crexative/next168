// The person-authority boundary (tasks design rev 6 §2.4, addendum 6.1 F4), checked on the graphs the real builds make:
// the app's (Vite and Rollup, after Vue SFC compilation, alias resolution and import.meta.glob expansion) and the
// companion's (its esbuild metafile). No assistant, proposal or companion module may reach the person's own commit
// module by any path, and no other module may re-export what it exports. A dynamic import whose target is not a literal
// fails the build: an edge nobody can see is refused, not ignored.
import { existsSync } from 'node:fs'
import { isAbsolute, join, relative } from 'node:path'
import type { Plugin as EsbuildPlugin } from 'esbuild'
import { build as viteBuild, loadConfigFromFile, type Plugin, type PluginOption } from 'vite'

export const PERSON_ACTIONS = 'src/features/tasks/personActions.ts'
export const FORBIDDEN_IMPORTERS = [/^src\/features\/assistant\//, /^src\/features\/proposals\//, /^companion\//]

export interface ModuleNode { imports: Set<string>; exports: Set<string> }
export type ModuleGraph = Map<string, ModuleNode>

// Source files that exist only for one graph build, by path relative to the repository root (mutation checks).
export type Overlay = Record<string, string>

function node(graph: ModuleGraph, path: string): ModuleNode {
  let entry = graph.get(path)
  if (!entry) graph.set(path, entry = { imports: new Set(), exports: new Set() })
  return entry
}

// A repository path for a module id, or undefined for dependencies and virtual modules.
function repositoryPath(root: string, id: string): string | undefined {
  if (id.startsWith('\0')) return undefined
  const file = id.split('?')[0]!
  if (!isAbsolute(file) || file.includes('/node_modules/')) return undefined
  const path = relative(root, file)
  return path.startsWith('..') ? undefined : path
}

class GraphComplete extends Error {
  constructor() { super('authority-graph-complete') }
}
const isGraphComplete = (error: unknown) => error instanceof Error && (error instanceof GraphComplete || error.message.includes('authority-graph-complete'))

function flatten(plugins: PluginOption[]): Plugin[] {
  return plugins.flatMap((plugin) => (Array.isArray(plugin) ? flatten(plugin) : plugin ? [plugin as Plugin] : []))
}

// The app's module graph from a real `vite build` of index.html, with every plugin of vite.config.ts (nothing written).
export async function appGraph(root: string, overlay: Overlay = {}): Promise<ModuleGraph> {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, join(root, 'vite.config.ts'), root, 'silent')
  if (!loaded) throw new Error('vite.config.ts not found')
  const plugins = flatten(loaded.config.plugins ?? [])
  const files = new Map(Object.entries(overlay).map(([path, code]) => [join(root, path), code]))
  const graph: ModuleGraph = new Map()
  const overlayPlugin: Plugin = {
    name: 'authority-overlay',
    enforce: 'pre',
    resolveId: (source) => [source, `${source}.ts`, `${source}.vue`].find((candidate) => files.has(candidate)) ?? null,
    load: (id) => files.get(id) ?? null,
  }
  const recorder: Plugin = {
    name: 'authority-graph',
    resolveDynamicImport(specifier, importer) {
      if (typeof specifier !== 'string') this.error(`non-literal dynamic import in ${relative(root, importer)}: every executable import must be visible`)
      return null
    },
    buildEnd(error) {
      if (error) return
      for (const id of this.getModuleIds()) {
        const from = repositoryPath(root, id)
        const info = this.getModuleInfo(id)
        if (!from || !info) continue
        const entry = node(graph, from)
        for (const exported of info.exports ?? []) entry.exports.add(exported)
        for (const target of [...info.importedIds, ...info.dynamicallyImportedIds]) {
          const to = repositoryPath(root, target)
          if (to && to !== from) entry.imports.add(to)
        }
      }
      // The graph is complete once the modules are loaded: the build stops here, before chunks, minifying and the PWA.
      throw new GraphComplete()
    },
  }
  try {
    await viteBuild({
    ...loaded.config,
    configFile: false,
    root,
    logLevel: 'silent',
    plugins: [overlayPlugin, ...plugins, recorder],
    build: { ...loaded.config.build, write: false, rollupOptions: { ...loaded.config.build?.rollupOptions, input: [join(root, 'index.html'), ...files.keys()] } },
    })
  } catch (error) {
    if (!isGraphComplete(error)) throw error
  }
  return graph
}

// The companion's module graph from its esbuild metafile (the options of companion/build.mjs, nothing written).
export async function companionGraph(root: string, overlay: Overlay = {}): Promise<ModuleGraph> {
  const files = new Map(Object.entries(overlay).map(([path, code]) => [join(root, path), code]))
  const overlayPlugin: EsbuildPlugin = {
    name: 'authority-overlay',
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => (files.has(args.path) ? { path: args.path } : undefined))
      build.onLoad({ filter: /.*/ }, (args) => (files.has(args.path) ? { contents: files.get(args.path)!, loader: 'ts', resolveDir: join(args.path, '..') } : undefined))
    },
  }
  const companion = join(root, 'companion')
  // The companion's own esbuild, the one companion/build.mjs runs.
  const { build: esbuild } = await import(join(companion, 'node_modules/esbuild/lib/main.js')) as typeof import('esbuild')
  const result = await esbuild({
    entryPoints: [join(companion, 'src/cli.ts'), ...files.keys()], outdir: join(companion, '.authority-graph'), write: false,
    bundle: true, platform: 'node', format: 'esm', target: 'node20', packages: 'bundle', metafile: true, logLevel: 'silent',
    absWorkingDir: companion, nodePaths: [join(companion, 'node_modules')], plugins: [overlayPlugin],
  })
  const graph: ModuleGraph = new Map()
  for (const [input, meta] of Object.entries(result.metafile!.inputs)) {
    const from = repositoryPath(root, isAbsolute(input) ? input : join(companion, input))
    if (!from) continue
    const entry = node(graph, from)
    for (const imported of meta.imports) {
      const to = repositoryPath(root, isAbsolute(imported.path) ? imported.path : join(companion, imported.path))
      if (to) entry.imports.add(to)
    }
  }
  return graph
}

// Every way the boundary is crossed: a forbidden module that reaches PERSON_ACTIONS (with the path), and a module other
// than PERSON_ACTIONS that imports it and exports one of its names again.
export function authorityViolations(graph: ModuleGraph, personExports: ReadonlySet<string> = graph.get(PERSON_ACTIONS)?.exports ?? new Set()): string[] {
  const violations: string[] = []
  for (const [start] of graph) {
    if (!FORBIDDEN_IMPORTERS.some((pattern) => pattern.test(start))) continue
    const previous = new Map<string, string>([[start, '']])
    const queue = [start]
    while (queue.length) {
      const current = queue.shift()!
      if (current === PERSON_ACTIONS) {
        const path = [current]
        for (let step = previous.get(current)!; step; step = previous.get(step)!) path.unshift(step)
        violations.push(`${start} reaches ${PERSON_ACTIONS}: ${path.join(' -> ')}`)
        break
      }
      for (const next of graph.get(current)?.imports ?? []) if (!previous.has(next)) { previous.set(next, current); queue.push(next) }
    }
  }
  for (const [path, entry] of graph) {
    if (path === PERSON_ACTIONS || !entry.imports.has(PERSON_ACTIONS)) continue
    const again = [...entry.exports].filter((name) => personExports.has(name))
    if (again.length) violations.push(`${path} re-exports ${again.join(', ')} from ${PERSON_ACTIONS}`)
  }
  return violations
}

export function repositoryRoot(): string {
  const root = join(__dirname, '..')
  if (!existsSync(join(root, PERSON_ACTIONS))) throw new Error(`${PERSON_ACTIONS} not found under ${root}`)
  return root
}
