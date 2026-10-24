import type { ShellRegistry } from '@/app/contracts'
import ConnectSettings from './ConnectSettings.vue'
export default function registerConnect(registry: ShellRegistry): void {
  registry.registerSettingsSection({ id: 'connect', component: ConnectSettings, titleKey: 'connect.title', order: 40 })
}
