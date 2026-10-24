import { Bell, Minus, Moon, SkipForward } from 'lucide-vue-next'
import type { ShellRegistry } from '@/app/contracts'
import { registerIcons } from '@/ui/icons'
import TodayView from './TodayView.vue'

export default function registerToday(registry: ShellRegistry): void {
  registerIcons({ bell: Bell, minus: Minus, moon: Moon, 'skip-forward': SkipForward })
  registry.registerView({ id: 'today', component: TodayView, titleKey: 'app.tabs.today', icon: 'sun', tabOrder: 0 })
}
