import { defineAsyncComponent } from 'vue'
import { registerIcons } from '@/ui/icons'
import type { ShellRegistry } from '@/app/contracts'
import { Sparkles } from 'lucide-vue-next'
import AssistantSettings from './AssistantSettings.vue'

export { default as AssistantSettings } from './AssistantSettings.vue'

export default function registerAssistant(registry: ShellRegistry): void {
  registerIcons({ sparkles: Sparkles })
  registry.registerView({
    id: 'assistant',
    titleKey: 'assistant.title',
    icon: 'sparkles',
    component: defineAsyncComponent(() => import('./AssistantView.vue')),
  })
  registry.registerSettingsSection({
    id: 'assistant',
    titleKey: 'assistant.title',
    order: 60,
    component: AssistantSettings,
  })
}
