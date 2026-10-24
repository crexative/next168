import { createApp, type App } from 'vue'
import { getActivePinia } from 'pinia'
import type { ShellRegistry } from '@/app/contracts'
import { i18n } from '@/i18n'
import registerCategorySettings from '@/features/settings/categories/register'
import registerDataSettings from '@/features/settings/data/register'
import OnboardingHost from './OnboardingHost.vue'

const HOST_ID = 'onboarding-host'

// The shell has no first-run overlay slot, so onboarding runs as its own small app sharing the shell's
// Pinia and i18n. It mounts after main.ts has installed Pinia, in the next microtask.
function mountOnboarding(): void {
  const pinia = getActivePinia()
  if (!pinia || document.getElementById(HOST_ID)) return
  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)
  const app: App = createApp(OnboardingHost)
  app.use(pinia)
  app.use(i18n)
  app.mount(host)
}

// Settings sections of this slice register here because the shell only auto-loads
// `features/<name>/index.ts` one level deep and `features/settings/` is shared with other slices.
export default function registerOnboarding(registry: ShellRegistry): void {
  registerCategorySettings(registry)
  registerDataSettings(registry)
  if (typeof document !== 'undefined') queueMicrotask(mountOnboarding)
}
