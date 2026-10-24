import type { ShellRegistry } from '@/app/contracts'
import CategorySettings from './CategorySettings.vue'

export default function registerCategorySettings(registry: ShellRegistry): void {
  registry.registerSettingsSection({ id: 'categories', component: CategorySettings, titleKey: 'categories.title', order: 20 })
}
