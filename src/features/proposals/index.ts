import { createApp } from 'vue'
import type { ShellRegistry } from '@/app/contracts'
import { configurePlannerStore } from '@/stores/plannerStore'
import { CompanionRepository, companionMode } from '@/repositories/CompanionRepository'
import { i18n } from '@/i18n'
import ProposalsView from './ProposalsView.vue'
import ConnectionPortal from './ConnectionPortal.vue'
import registerConnect from '../settings/connect'

export { openProposalReview } from './openProposalReview'

export default function registerProposals(registry: ShellRegistry): void {
  if (companionMode) configurePlannerStore({
    repository: new CompanionRepository(), now: () => new Date(), newId: () => crypto.randomUUID(),
    locale: () => i18n.global.locale.value, timeZone: () => Intl.DateTimeFormat().resolvedOptions().timeZone,
  })
  registry.registerView({ id: 'proposals', component: ProposalsView, titleKey: 'proposals.title' })
  registerConnect(registry)
  const host = document.createElement('div')
  host.dataset.next168Connection = ''
  document.body.append(host)
  const portal = createApp(ConnectionPortal).use(i18n)
  portal.mount(host)
  window.addEventListener('pagehide', () => { portal.unmount(); host.remove() }, { once: true })
}
