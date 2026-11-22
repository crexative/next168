import { Bell, ChevronDown, Minus, Moon } from 'lucide-vue-next'
import type { ShellRegistry } from '@/app/contracts'
import { registerIcons } from '@/ui/icons'
import TodayView from './TodayView.vue'

export { default as ItemStatusControl } from './ItemStatusControl.vue'
export { isReportable } from './statusWindow'
export { useBlockStatus } from './useBlockStatus'

export default function registerToday(registry: ShellRegistry): void {
  registerIcons({ bell: Bell, 'chevron-down': ChevronDown, minus: Minus, moon: Moon })
  registry.registerView({ id: 'today', component: TodayView, titleKey: 'app.tabs.today', icon: 'sun', tabOrder: 0, backdrop: 'plain', measure: 'wide' })
}
