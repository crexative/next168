import './assets/base.css'

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'

import App from './App.vue'
import { registerBuiltinViews } from './app/builtinViews'
import { registerFeatures } from './app/features'
import { shell } from './app/registry'
import { useAssistant } from './features/assistant/useAssistant'
import { announceUpdate, createUpdateApplier } from './app/updates'
import { i18n } from './i18n'
import type { ProposalInput } from './core/model'
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

const updater = createUpdateApplier(() => updateServiceWorker())
const updateServiceWorker = registerSW({
  onNeedRefresh: () => announceUpdate(updater.apply),
  onNeedReload: updater.onActivated,
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
    // Makes the quick-answers provider reply with a proposal, as a model would: the rules provider never proposes.
    answerWithProposal: (summary: string, ops: ProposalInput['ops']) => {
      useAssistant().providers.rules.ask = async () => ({
        answer: summary,
        proposal: { contractVersion: '1.0', workspaceId: planner.document!.workspaceId, baseRevision: planner.document!.revision, summary, ops },
      })
    },
  }
}
