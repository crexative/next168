import type { ShellRegistry } from '@/app/contracts'
import WeekView from './WeekView.vue'

export default function registerWeek(registry: ShellRegistry): void {
  registry.registerView({ id: 'week', component: WeekView, titleKey: 'app.tabs.week', icon: 'calendar-days', tabOrder: 1 })
}
