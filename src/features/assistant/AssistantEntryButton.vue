<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { Sparkles } from 'lucide-vue-next'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import { registerIcons } from '@/ui/icons'

registerIcons({ sparkles: Sparkles })

// The one way into the assistant: a toolbar icon. In the app it moves itself into the shell's toolbar
// (`#toolbar-actions`, next to the settings gear); without that slot it renders where it is placed.
const { t } = useI18n()
// The toolbar sits in the same view and is only attached once the view is mounted, so it is looked up then.
const toolbar = ref<HTMLElement | null>(null)
const ready = ref(false)
onMounted(() => {
  toolbar.value = document.getElementById('toolbar-actions')
  ready.value = true
})
</script>

<template>
  <Teleport v-if="ready" :to="toolbar ?? 'body'" :disabled="!toolbar">
    <a class="assistant-entry" href="#/assistant" :aria-label="t('common.askAssistant')" data-testid="assistant-entry">
      <Icon name="sparkles" :size="24" />
    </a>
  </Teleport>
</template>

<style scoped>
.assistant-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  border-radius: 50%;
  color: var(--tint-label);
  text-decoration: none;
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
  touch-action: manipulation;
}
.assistant-entry:active { transform: scale(0.97); opacity: 0.85; }
@media (prefers-reduced-motion: reduce) {
  .assistant-entry:active { transform: none; opacity: 0.7; }
}
</style>
