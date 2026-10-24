import { Download, Pencil, Trash2, Upload } from 'lucide-vue-next'
import type { ShellRegistry } from '@/app/contracts'
import { registerIcons } from '@/ui/icons'
import { trackNavigation } from './navigationTrail'
import SettingsHome from './SettingsHome.vue'

// One section: the shell lists every registered section on the Settings screen, and this slice decides what
// sits at the top level (Categories and Data) and what lives one level down (Integrations and advanced).
export default function registerSettings(registry: ShellRegistry): void {
  registerIcons({ download: Download, upload: Upload, 'trash-2': Trash2, pencil: Pencil })
  trackNavigation()
  registry.registerSettingsSection({ id: 'settings', component: SettingsHome, titleKey: 'app.tabs.settings', order: 10 })
}
