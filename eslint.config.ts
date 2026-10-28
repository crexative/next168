import { globalIgnores } from 'eslint/config'
import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'

export default defineConfigWithVueTs(
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
  },

  globalIgnores(['**/dist/**', '**/dist-ssr/**', '**/coverage/**', 'e2e/.results/**', 'e2e/.report/**', 'e2e/artifacts/**', 'dev-dist/**', '.pre-fence-source/**', '.production-v1/**', '.production-v1-source/**', '.wrangler/**', 'e2e/.wrangler-state/**']),

  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,

  {
    // The pre-upgrade copy is a version-2 artifact (tasks design rev 6 §2.2): capture, download and their hash never go
    // through the current parser, schemas or bundle hash, which follow the current document version.
    name: 'app/pre-upgrade-copy-is-frozen',
    files: ['src/repositories/storageVersion.ts', 'src/features/settings/data/preUpgradeCopy.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': ['error', {
        paths: [
          { name: '@/core/exportBundle', allowImportNames: ['portableDigest'], message: 'Use portableDigest with legacy/v2 validation.' },
          { name: '@/core/documents', message: 'Use the frozen legacy/v2 module.' },
          { name: '@/core/model', allowTypeImports: true, message: 'Use the frozen legacy/v2 schemas.' },
          { name: '@/repositories/core', message: 'Use the frozen legacy/v2 module.' },
          { name: './core', message: 'Use the frozen legacy/v2 module.' },
        ],
      }],
    },
  },

  {
    name: 'app/ui-primitives',
    files: ['src/ui/*.vue'],
    rules: { 'vue/multi-word-component-names': 'off' },
  },
)
