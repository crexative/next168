import { fileURLToPath, URL } from 'node:url'
import { join } from 'node:path'
import { defineConfig, type Plugin } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { preFenceDir } from './config/preFence'

const root = fileURLToPath(new URL('./', import.meta.url))
const src = join(root, 'src')
const oldSrc = join(preFenceDir(root), 'src')

// `@old/*` is the pre-fence build's source; inside it, `@/` (already expanded to this checkout's src) points back
// to the pre-fence source, so old modules never mix with new ones.
function preFenceAlias(): Plugin {
  return {
    name: 'next168-pre-fence-alias',
    enforce: 'pre',
    resolveId(source, importer) {
      if (source.startsWith('@old/')) return this.resolve(join(oldSrc, source.slice('@old/'.length)), importer, { skipSelf: true })
      if (importer?.startsWith(oldSrc) && source.startsWith(src + '/')) return this.resolve(join(oldSrc, source.slice(src.length + 1)), importer, { skipSelf: true })
      return null
    },
  }
}

export default defineConfig({
  plugins: [vue(), preFenceAlias()],
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
