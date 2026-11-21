import { defineAsyncComponent } from 'vue'
import { registerIcons } from '@/ui/icons'
import type { ShellRegistry } from '@/app/contracts'
import { ArrowUp, Lock, Sparkles } from 'lucide-vue-next'

export { default as AssistantSettings } from './AssistantSettings.vue'

export default function registerAssistant(registry: ShellRegistry): void {
  registerIcons({ sparkles: Sparkles, 'arrow-up': ArrowUp, lock: Lock })
  registry.registerView({
    id: 'assistant',
    titleKey: 'assistant.title',
    icon: 'sparkles',
    component: defineAsyncComponent(() => import('./AssistantView.vue')),
  })
}
