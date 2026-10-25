<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import BackButton from '@/features/settings/BackButton.vue'
import AnyAiPanel from './anyAi/AnyAiPanel.vue'
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

const SUGGESTIONS = ['hours', 'next', 'overflow'] as const
const suggestions = computed(() => SUGGESTIONS.map((key) => ({ key, text: t(`assistant.suggestions.${key}`) })))

// Free text only reaches something that can act on it: the on-device model. Without it the suggested questions
// are the way to ask, so they stay. The model's status and the download live in Settings › Advanced; the
// download card shows here only after the person chose the model there.
const canType = computed(() => assistant.active.value === 'webllm')
const showSuggestions = computed(() => !canType.value || assistant.messages.value.length === 0)
const offerDownload = computed(() => assistant.preference.value === 'webllm' && modelState.value === 'downloadable' && !assistant.busy.value)

// A count in the parameters picks the plural form of the answer ("1 task does not fit" / "2 tasks do not fit").
function translate(key: string, params?: Record<string, unknown>): string {
  const count = params?.count
  return typeof count === 'number' ? t(key, params ?? {}, count) : t(key, params ?? {})
}

async function ask(text: string): Promise<void> {
  const document = planner.document
  if (!document || !text.trim()) return
  await assistant.ask(text, { document, now: new Date(), locale: locale.value, timeZone: document.settings.timeZone, translate })
}

async function submit(): Promise<void> {
  const text = question.value
  if (!planner.document || !text.trim()) return
  question.value = ''
  await ask(text)
}
</script>

<template>
  <div class="assistant">
    <BackButton current="assistant" fallback="today" />

    <section class="chat" data-testid="chat" :aria-label="t('assistant.chat.label')">
      <div v-if="failureMessage" class="failure-row">
        <p class="t-subhead failure" role="alert" data-testid="assistant-failure">{{ failureMessage }}</p>
        <Button v-if="canRetry" variant="tinted" data-testid="assistant-retry" @click="assistant.prepareModel()">{{ t('assistant.retry') }}</Button>
      </div>
      <ol class="messages" aria-live="polite">
        <li v-for="message in assistant.messages.value" :key="message.id" class="message" :class="`is-${message.role}`" :data-role="message.role">
          <p class="t-body bubble">{{ message.text }}</p>
          <ProposalCard v-if="message.proposal" :input="message.proposal" />
        </li>
      </ol>
      <p v-if="assistant.busy.value === 'asking'" class="t-footnote t-secondary" role="status">{{ t('assistant.chat.thinking') }}</p>
    </section>

    <ul v-if="showSuggestions" class="suggestions" :aria-label="t('assistant.suggestions.label')" data-testid="suggestions">
      <li v-for="suggestion in suggestions" :key="suggestion.key">
        <button class="suggestion t-subhead" type="button" :disabled="!planner.document || assistant.busy.value === 'asking'" @click="ask(suggestion.text)">{{ suggestion.text }}</button>
      </li>
    </ul>
    <!-- "Usar con tu IA": beside the suggested questions, the way to ask anything else (and the one AI entry). -->
    <AnyAiPanel collapsible />

    <section v-if="offerDownload" class="card" aria-labelledby="optin-title">
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

    <!-- At the bottom, under the conversation, like any chat. -->
    <form v-if="canType" class="composer" data-testid="composer" @submit.prevent="submit">
      <label class="sr-only" for="assistant-question">{{ t('assistant.chat.label') }}</label>
      <input id="assistant-question" v-model="question" class="input t-body" type="text" autocomplete="off" enterkeyhint="send" :placeholder="t('assistant.chat.placeholder')" :disabled="!planner.document">
      <Button v-if="assistant.busy.value === 'asking'" variant="tinted" @click="assistant.cancel()">{{ t('assistant.progress.cancel') }}</Button>
      <Button v-else type="submit" :disabled="!question.trim() || !planner.document">{{ t('assistant.chat.send') }}</Button>
    </form>

    <footer class="notes" data-testid="notes">
      <p class="t-footnote t-secondary">{{ t('assistant.privacy') }}</p>
    </footer>
  </div>
</template>

<style scoped>
/* Same 16 px side gutter as the other screens. */
.assistant { display: flex; flex-direction: column; gap: var(--space-4); max-width: 40rem; padding: 0 var(--page-gutter) var(--space-6); }
.card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--card-padding-block) var(--card-padding); background: var(--surface); border-radius: var(--radius-card); }
progress { width: 100%; accent-color: var(--tint); }
.chat { display: flex; flex-direction: column; gap: var(--space-3); }
/* An empty conversation leaves the flow (no gap) but stays in the page, so its live region announces the first answer. */
.chat:not(:has(li, p)) { position: absolute; }
.messages { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.message { max-width: 90%; }
.message.is-user { align-self: flex-end; }
.bubble { margin: 0; padding: var(--space-2) var(--space-3); border-radius: var(--radius-card); background: var(--surface); white-space: pre-line; }
.is-user .bubble { background: var(--tint); color: var(--tint-text); }
.failure-row { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
.failure { margin: 0; color: var(--danger-label); }
.composer { display: flex; flex-wrap: wrap; gap: var(--space-2); }
/* The hint stays whole: on a narrow screen the button drops to its own line instead of squeezing the field. */
.composer .input { flex: 1 1 16rem; min-width: 0; }
.composer > button { margin-inline-start: auto; }
.suggestions { display: flex; flex-wrap: wrap; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.suggestion { min-height: var(--tap-target); padding: var(--space-2) var(--space-4); border: 0; border-radius: 999px; background: color-mix(in srgb, var(--tint) 12%, transparent); color: var(--tint-label); text-align: start; transition: transform 0.1s var(--ease-out), opacity 0.1s; touch-action: manipulation; }
.suggestion:active:not(:disabled) { transform: scale(0.97); opacity: 0.85; }
.suggestion:disabled { opacity: 0.4; }
.notes { display: flex; flex-direction: column; gap: var(--space-1); margin-top: var(--space-2); }
.notes p { margin: 0; }
@media (prefers-reduced-motion: reduce) { .suggestion:active:not(:disabled) { transform: none; opacity: 0.7; } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
