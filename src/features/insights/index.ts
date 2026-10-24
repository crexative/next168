import type { ShellRegistry } from '@/app/contracts'
import InsightsView from './InsightsView.vue'

export default function registerInsights(registry: ShellRegistry): void {
  registry.registerView({
    id: 'insights',
    component: InsightsView,
    titleKey: 'app.tabs.insights',
    icon: 'chart-no-axes-column',
    tabOrder: 3,
  })
}
