<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import ListGroup from '@/ui/ListGroup.vue'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import { viewHash } from '@/app/useHashRoute'
import type { ProviderChoice } from './selectProvider'
import { useAssistant } from './useAssistant'

const { t } = useI18n()
const assistant = useAssistant()
const deleting = ref(false)

const options = computed(() => (['rules', 'webllm'] as ProviderChoice[]).map((value) => ({ value, label: t(`assistant.providers.${value}`) })))
const modelPresent = computed(() => assistant.availability.webllm === 'available')
const modelState = computed(() => assistant.availability.webllm)

onMounted(() => { void assistant.refresh() })

async function remove(): Promise<void> {
  deleting.value = true
  try {
    await assistant.deleteModel()
  } finally {
    deleting.value = false
  }
}
</script>

<template>
  <ListGroup class="assistant-settings" :header="t('assistant.settings.header')" :footer="t('assistant.privacy')">
    <li class="settings-body">
      <!-- The model's status lives here, one level below Settings, not on the assistant screen. -->
      <p class="t-footnote t-secondary" data-testid="assistant-status">
        <i18n-t keypath="assistant.status.line" scope="global" tag="span">
          <template #rules><span data-testid="status-rules">{{ t('assistant.status.available') }}</span></template>
          <template #model><span data-testid="status-webllm">{{ t(`assistant.status.${modelState}`) }}</span></template>
        </i18n-t>
      </p>
      <SegmentedControl :model-value="assistant.preference.value" :options="options" :label="t('assistant.settings.provider')" @update:model-value="assistant.choose($event)" />
      <p v-if="assistant.preference.value === 'webllm' && assistant.availability.webllm === 'downloadable'" class="t-footnote t-secondary">
        {{ t('assistant.settings.needsDownload') }} <a :href="viewHash('assistant')">{{ t('assistant.settings.openAssistant') }}</a>
      </p>
      <p v-if="assistant.availability.webllm === 'unavailable'" class="t-footnote t-secondary">{{ t('assistant.status.webllmDetail.unavailable') }}</p>
      <Button v-if="modelPresent" variant="tinted" destructive :disabled="deleting" @click="remove">{{ t('assistant.settings.deleteModel') }}</Button>
    </li>
  </ListGroup>
</template>

<style scoped>
/* Same side gutter as the other settings sections. */
.assistant-settings { padding-inline: var(--page-gutter); }
.settings-body { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); padding: var(--space-4) var(--card-padding); }
/* Full width like every other segmented control, so "On-device model" does not wrap. */
.settings-body > .segmented { align-self: stretch; }
</style>
