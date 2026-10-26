import { fileURLToPath, URL } from 'node:url'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { fencedV2Dir, preFenceDir } from './config/preFence'

const root = fileURLToPath(new URL('./', import.meta.url))
const src = join(root, 'src')
const pinned = [
  { prefix: '@old/', src: join(preFenceDir(root), 'src') },
  { prefix: '@fencedV2/', src: join(fencedV2Dir(root), 'src') },
]

// `@old/*` is the pre-fence build's source and `@fencedV2/*` the last build fenced at storage version 2; inside each,
// `@/` (already expanded to this checkout's src) points back to that tree, so old modules never mix with new ones.
function pinnedTreeAlias(): Plugin {
  return {
    name: 'next168-pinned-tree-alias',
    enforce: 'pre',
    resolveId(source, importer) {
      for (const tree of pinned) {
        if (source.startsWith(tree.prefix)) return this.resolve(join(tree.src, source.slice(tree.prefix.length)), importer, { skipSelf: true })
        if (importer?.startsWith(tree.src + '/') && source.startsWith(src + '/')) return this.resolve(join(tree.src, source.slice(src.length + 1)), importer, { skipSelf: true })
      }
      return null
    },
  }
}

export default defineConfig({
  plugins: [vue(), pinnedTreeAlias()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'happy-dom',
    include: ['src/**/*.spec.ts', 'src/**/*.test.ts', 'config/**/*.spec.ts'],
    root,
    setupFiles: ['./src/test/setup.ts'],
    globalSetup: ['./config/preFenceSetup.ts'],
  },
})
