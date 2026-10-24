<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import ListGroup from '@/ui/ListGroup.vue'
import ListRow from '@/ui/ListRow.vue'
import ProposalCard from './ProposalCard.vue'
import { WEBLLM_DOWNLOAD_BYTES } from './WebLlmProvider'
import { useAssistant } from './useAssistant'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const assistant = useAssistant()
const question = ref('')

const sizeLabel = `${Math.round(WEBLLM_DOWNLOAD_BYTES / 1_000_000)} MB`
const onCellular = computed(() => (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection?.type === 'cellular')
const percent = computed(() => Math.round((assistant.progress.value?.fraction ?? 0) * 100))
const modelState = computed(() => assistant.availability.webllm)
const failureMessage = computed(() => assistant.failure.value ? t(`assistant.failures.${assistant.failure.value}`) : null)

// A download that failed (network error or offline) can be tried again; the opt-in card is hidden while it runs.
const canRetry = computed(() => (assistant.failure.value === 'network' || assistant.failure.value === 'offline') && modelState.value === 'downloadable' && !assistant.busy.value)

onMounted(() => { void assistant.refresh() })

async function submit(): Promise<void> {
  const document = planner.document
  if (!document || !question.value.trim()) return
  const text = question.value
  question.value = ''
  await assistant.ask(text, {
    document, now: new Date(), locale: locale.value, timeZone: document.settings.timeZone,
    translate: (key, params) => t(key, params ?? {}),
  })
}
</script>

<template>
  <div class="assistant">
    <ListGroup :header="t('assistant.status.header')">
      <ListRow :title="t('assistant.providers.rules')" :subtitle="t('assistant.status.rulesDetail')">
        <template #trailing><span data-testid="status-rules">{{ t('assistant.status.available') }}</span></template>
      </ListRow>
      <ListRow :title="t('assistant.providers.webllm')" :subtitle="t(`assistant.status.webllmDetail.${modelState}`)">
        <template #trailing><span data-testid="status-webllm">{{ t(`assistant.status.${modelState}`) }}</span></template>
      </ListRow>
    </ListGroup>

    <section v-if="modelState === 'downloadable' && !assistant.busy.value" class="card" aria-labelledby="optin-title">
      <h2 id="optin-title" class="t-headline">{{ t('assistant.optIn.title') }}</h2>
      <p class="t-subhead">{{ t('assistant.optIn.body', { size: sizeLabel }) }}</p>
      <p class="t-footnote t-secondary">{{ t(onCellular ? 'assistant.optIn.cellular' : 'assistant.optIn.wifi') }}</p>
      <Button block @click="assistant.prepareModel()">{{ t('assistant.optIn.download', { size: sizeLabel }) }}</Button>
    </section>

    <section v-if="assistant.busy.value === 'preparing'" class="card" role="status" aria-live="polite">
      <p class="t-headline">{{ t('assistant.progress.title') }}</p>
      <progress :value="percent" max="100" :aria-label="t('assistant.progress.title')" />
      <p class="t-footnote t-secondary">{{ t('assistant.progress.detail', { percent }) }}</p>
      <Button variant="tinted" @click="assistant.cancel()">{{ t('assistant.progress.cancel') }}</Button>
    </section>

    <section class="chat" :aria-label="t('assistant.chat.label')">
      <ol class="messages" aria-live="polite">
        <li v-for="message in assistant.messages.value" :key="message.id" class="message" :class="`is-${message.role}`" :data-role="message.role">
          <p class="t-body bubble">{{ message.text }}</p>
          <ProposalCard v-if="message.proposal" :input="message.proposal" />
        </li>
      </ol>
      <div v-if="failureMessage" class="failure-row">
        <p class="t-subhead failure" role="alert" data-testid="assistant-failure">{{ failureMessage }}</p>
        <Button v-if="canRetry" variant="tinted" data-testid="assistant-retry" @click="assistant.prepareModel()">{{ t('assistant.retry') }}</Button>
      </div>
      <p v-if="assistant.busy.value === 'asking'" class="t-footnote t-secondary" role="status">{{ t('assistant.chat.thinking') }}</p>
      <form class="composer" @submit.prevent="submit">
        <label class="sr-only" for="assistant-question">{{ t('assistant.chat.label') }}</label>
        <input id="assistant-question" v-model="question" class="field t-body" type="text" autocomplete="off" :placeholder="t('assistant.chat.placeholder')" :disabled="!planner.document">
        <Button v-if="assistant.busy.value === 'asking'" variant="tinted" @click="assistant.cancel()">{{ t('assistant.progress.cancel') }}</Button>
        <Button v-else type="submit" :disabled="!question.trim() || !planner.document">{{ t('assistant.chat.send') }}</Button>
      </form>
      <p class="t-footnote t-secondary">{{ t('assistant.privacy') }}</p>
    </section>
  </div>
</template>

<style scoped>
.assistant { display: flex; flex-direction: column; gap: var(--space-4); max-width: 40rem; }
.card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
progress { width: 100%; accent-color: var(--tint); }
.chat { display: flex; flex-direction: column; gap: var(--space-3); }
.messages { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.message { max-width: 90%; }
.message.is-user { align-self: flex-end; }
.bubble { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-card); background: var(--surface); white-space: pre-line; }
.is-user .bubble { background: var(--tint); color: var(--tint-text); }
.failure-row { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
.failure { margin: 0; color: var(--danger-label); }
.composer { display: flex; gap: var(--space-2); }
.field { flex: 1; min-width: 0; min-height: var(--tap-target); padding: 0 var(--space-3); border: 0; border-radius: var(--radius-control); background: var(--surface); color: var(--label); }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
