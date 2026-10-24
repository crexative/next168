import './assets/base.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'

import App from './App.vue'
import { registerBuiltinViews } from './app/builtinViews'
import { registerFeatures } from './app/features'
import { shell } from './app/registry'
import { announceUpdate } from './app/updates'
import { i18n } from './i18n'
import { createBrowserRepositories } from './repositories/browserRepositories'
import { configurePlannerStore, usePlannerStore } from './stores/plannerStore'

const repositories = createBrowserRepositories()
configurePlannerStore({
  repository: repositories.planner,
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
  locale: () => i18n.global.locale.value,
  timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
})

registerBuiltinViews(shell.registry)
registerFeatures(shell.registry)

const updateServiceWorker = registerSW({
  onNeedRefresh: () => announceUpdate(() => updateServiceWorker(true)),
})

const app = createApp(App)
app.use(createPinia())
app.use(i18n)
app.mount('#app')

if (import.meta.env.VITE_E2E) {
  const planner = usePlannerStore()
  ;(window as unknown as { __next168Test: unknown }).__next168Test = {
    setTimeZone: (timeZone: string) => planner.commit((draft) => { draft.settings.timeZone = timeZone }),
    revision: () => planner.document?.revision ?? null,
    timeZone: () => planner.document?.settings.timeZone ?? null,
    error: () => planner.error,
    proposals: repositories.proposals,
  }
}
