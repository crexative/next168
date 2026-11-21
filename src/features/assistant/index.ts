import { defineAsyncComponent } from 'vue'
import { registerIcons } from '@/ui/icons'
import type { ShellRegistry } from '@/app/contracts'
import { ArrowUp, ChevronDown, Lock, Sparkles } from 'lucide-vue-next'

export { default as AssistantSettings } from './AssistantSettings.vue'

export default function registerAssistant(registry: ShellRegistry): void {
  registerIcons({ sparkles: Sparkles, 'arrow-up': ArrowUp, 'chevron-down': ChevronDown, lock: Lock })
  registry.registerView({
    id: 'assistant',
    titleKey: 'assistant.title',
    icon: 'sparkles',
    backdrop: 'plain',
    component: defineAsyncComponent(() => import('./AssistantView.vue')),
  })
}
