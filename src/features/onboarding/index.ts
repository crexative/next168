import { createApp, type App } from 'vue'
import { getActivePinia } from 'pinia'
import { ArrowUp, ChevronLeft, Clock } from 'lucide-vue-next'
import type { ShellRegistry } from '@/app/contracts'
import { i18n } from '@/i18n'
import registerSettings from '@/features/settings/register'
import { registerIcons } from '@/ui/icons'
import OnboardingRoot from './OnboardingRoot.vue'

export { default as SetupWeekPrompt } from './SetupWeekPrompt.vue'

const HOST_ID = 'onboarding-host'

// The shell has no first-run overlay slot, so onboarding runs as its own small app sharing the shell's
// Pinia and i18n. It mounts after main.ts has installed Pinia, in the next microtask.
function mountOnboarding(): void {
  const pinia = getActivePinia()
  if (!pinia || document.getElementById(HOST_ID)) return
  const host = document.createElement('div')
  host.id = HOST_ID
  document.body.appendChild(host)
  const app: App = createApp(OnboardingRoot)
  app.use(pinia)
  app.use(i18n)
  app.mount(host)
}

// Settings sections of this slice register here because the shell only auto-loads
// `features/<name>/index.ts` one level deep and `features/settings/` is shared with other slices.
export default function registerOnboarding(registry: ShellRegistry): void {
  registerSettings(registry)
  registerIcons({ 'arrow-up': ArrowUp, 'chevron-left': ChevronLeft, clock: Clock })
  if (typeof document !== 'undefined') queueMicrotask(mountOnboarding)
}
