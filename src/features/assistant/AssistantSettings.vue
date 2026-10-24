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
  <ListGroup :header="t('assistant.settings.header')" :footer="t('assistant.privacy')">
    <li class="settings-body">
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
.settings-body { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-3); padding: var(--space-4); }
</style>
