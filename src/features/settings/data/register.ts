import { Download, Trash2, Upload } from 'lucide-vue-next'
import type { ShellRegistry } from '@/app/contracts'
import { registerIcons } from '@/ui/icons'
import DataSettings from './DataSettings.vue'

export default function registerDataSettings(registry: ShellRegistry): void {
  registerIcons({ download: Download, upload: Upload, 'trash-2': Trash2 })
  registry.registerSettingsSection({ id: 'data', component: DataSettings, titleKey: 'data.title', order: 30 })
}
