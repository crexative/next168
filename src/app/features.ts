import type { ShellRegistry } from './contracts'

type FeatureModule = { default: (registry: ShellRegistry) => void }

// Feature slices add src/features/<name>/index.ts with a default export `(registry) => void`;
// a later registration with the same view id replaces the shell placeholder.
const featureModules = import.meta.glob<FeatureModule>('../features/*/index.ts', { eager: true })

export function registerFeatures(registry: ShellRegistry, modules: Record<string, FeatureModule> = featureModules): void {
  for (const module of Object.values(modules)) module.default(registry)
}
