<script setup lang="ts">
import { computed, inject, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { SHEET_PRESENTED } from '@/app/contracts'
import { AI_HASH } from '@/features/settings/route'
import { usePlannerStore } from '@/stores/plannerStore'
import { localDateOf } from '@/core/time'
import { externalForAi } from '@/core/aiProjection'
import { formatBytes } from '@/ui/format'
import { useExternalOccurrences } from '@/features/week/externalOccurrences'
import AppMark from '@/ui/AppMark.vue'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import BackButton from '@/features/settings/BackButton.vue'
import ProposalCard from './ProposalCard.vue'
import { WEBLLM_DOWNLOAD_BYTES } from './WebLlmProvider'
import { useAssistant } from './useAssistant'
import type { ProviderChoice } from './selectProvider'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const assistant = useAssistant()
const question = ref('')
const inSheet = inject(SHEET_PRESENTED, ref(false))
const external = useExternalOccurrences(() => planner.document ? { fromDate: localDateOf(new Date(), planner.document.settings.timeZone), days: 7, timeZone: planner.document.settings.timeZone } : null)

const sizeLabel = computed(() => formatBytes(WEBLLM_DOWNLOAD_BYTES, locale.value))
const onCellular = computed(() => (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection?.type === 'cellular')
const percent = computed(() => Math.round((assistant.progress.value?.fraction ?? 0) * 100))
const modelState = computed(() => assistant.availability.webllm)
const failureMessage = computed(() => assistant.failure.value ? t(`assistant.failures.${assistant.failure.value}`, { size: sizeLabel.value }) : null)

// A download that failed (network error, offline, or no space left) can be tried again; the opt-in card is hidden while it runs.
const RETRYABLE = new Set(['network', 'offline', 'storage-full'])
const canRetry = computed(() => RETRYABLE.has(assistant.failure.value ?? '') && modelState.value === 'downloadable' && !assistant.busy.value)

onMounted(() => { void assistant.refresh() })

const SUGGESTIONS = ['hours', 'next', 'overflow'] as const
const suggestions = computed(() => SUGGESTIONS.map((key) => ({ key, text: t(`assistant.suggestions.${key}`) })))

// Free text only reaches something that can act on it: the on-device model. Without it the suggested questions
// are the way to ask, so they stay. The model's status and the download live in Settings › Advanced; the
// download card shows here only after the person chose the model there.
const canType = computed(() => assistant.active.value === 'webllm')
const showSuggestions = computed(() => !canType.value || assistant.messages.value.length === 0)
// "Responder con" (R_Asistente): one pop-up under the title instead of the two cards. Quick answers and the on-device
// model answer here; "Usar con tu IA" is the way to ask anything with the AI you already use, on its own page.
const ANY_AI = 'anyAi'
const replyOptions = computed(() => [
  { value: 'rules', label: t('assistant.providers.rules'), disabled: false },
  { value: 'webllm', label: t('assistant.providers.webllm'), disabled: modelState.value === 'unavailable' },
  { value: ANY_AI, label: t('settings.aiRow'), disabled: false },
])
const replyLabel = computed(() => replyOptions.value.find((option) => option.value === assistant.preference.value)?.label ?? '')
function chooseReply(event: Event): void {
  const select = event.target as HTMLSelectElement
  if (select.value === ANY_AI) {
    select.value = assistant.preference.value
    window.location.hash = AI_HASH
    return
  }
  assistant.choose(select.value as ProviderChoice)
}
const offerDownload = computed(() => assistant.preference.value === 'webllm' && modelState.value === 'downloadable' && !assistant.busy.value)

// A count in the parameters picks the plural form of the answer ("1 task does not fit" / "2 tasks do not fit").
function translate(key: string, params?: Record<string, unknown>): string {
  const count = params?.count
  return typeof count === 'number' ? t(key, params ?? {}, count) : t(key, params ?? {})
}

async function ask(text: string): Promise<void> {
  const document = planner.document
  if (!document || !text.trim()) return
  await assistant.ask(text, { document, now: new Date(), locale: locale.value, timeZone: document.settings.timeZone, translate, external: externalForAi(external.value, t('calendars.googleConnection.busyForAi')) })
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
    <BackButton v-if="!inSheet" current="assistant" fallback="today" />
    <label class="reply-with t-subhead" data-testid="reply-with">
      <span class="t-secondary">{{ t('assistant.settings.provider') }}:</span>
      <span class="reply-value">{{ replyLabel }}<Icon name="chevron-down" :size="16" /></span>
      <select class="reply-select" :value="assistant.preference.value" :aria-label="t('assistant.settings.provider')" @change="chooseReply">
        <option v-for="option in replyOptions" :key="option.value" :value="option.value" :disabled="option.disabled">{{ option.label }}</option>
      </select>
    </label>

    <section class="chat" data-testid="chat" :aria-label="t('assistant.chat.label')">
      <div v-if="failureMessage" class="failure-row">
        <p class="t-subhead failure" role="alert" data-testid="assistant-failure">{{ failureMessage }}</p>
        <Button v-if="canRetry" variant="tinted" data-testid="assistant-retry" @click="assistant.prepareModel()">{{ t('assistant.retry') }}</Button>
      </div>
      <ol class="messages" aria-live="polite">
        <!-- One conversation language with setup and the check-in (R_Asistente): your words as your bubbles on the trailing
             side, Weeklid's beside its mark. -->
        <li v-for="message in assistant.messages.value" :key="message.id" class="message" :class="`is-${message.role}`" :data-role="message.role">
          <AppMark v-if="message.role !== 'user'" class="avatar" :size="32" />
          <div class="said">
            <p class="t-body bubble">{{ message.text }}</p>
            <ProposalCard v-if="message.proposal" :input="message.proposal" :basis="planner.document" />
          </div>
        </li>
      </ol>
      <p v-if="assistant.busy.value === 'asking'" class="t-footnote t-secondary" role="status">{{ t('assistant.chat.thinking') }}</p>
    </section>

    <div class="dock" data-testid="assistant-dock">
    <ul v-if="showSuggestions" class="suggestions" :aria-label="t('assistant.suggestions.label')" data-testid="suggestions">
      <li v-for="suggestion in suggestions" :key="suggestion.key">
        <button class="suggestion t-subhead" type="button" :disabled="!planner.document || assistant.busy.value === 'asking'" @click="ask(suggestion.text)">{{ suggestion.text }}</button>
      </li>
    </ul>

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
      <button v-else class="send" type="submit" :aria-label="t('assistant.chat.send')" :disabled="!question.trim() || !planner.document" data-testid="assistant-send"><Icon name="arrow-up" :size="22" /></button>
    </form>

    <footer class="notes" data-testid="notes">
      <p class="t-footnote t-secondary privacy"><Icon name="lock" :size="13" class="lock" />{{ t('assistant.privacy') }}</p>
    </footer>
    </div>
  </div>
</template>

<style scoped>
/* Same 16 px side gutter as the other screens. */
.assistant { display: flex; flex-direction: column; gap: var(--space-4); max-width: 40rem; min-height: calc(100dvh - var(--safe-top) - var(--toolbar-height) - var(--space-6)); padding: 0 var(--page-gutter); }
.card { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--card-padding-block) var(--card-padding); background: var(--surface-2); border-radius: var(--radius-card); }
/* "Responder con: Respuestas rápidas ⌄" under the title: a native pop-up behind the visible value, so it is one tap and
   the system menu. */
.reply-with { position: relative; align-self: center; display: inline-flex; flex-wrap: wrap; justify-content: center; align-items: center; column-gap: var(--space-1); min-height: var(--tap-target); padding-inline: var(--space-2); text-align: center; }
.reply-value { display: inline-flex; align-items: center; gap: 2px; color: var(--label); font-weight: 600; }
.reply-select { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; font-size: 1rem; cursor: pointer; }
.reply-with:has(.reply-select:focus-visible) { outline: 2px solid var(--tint); outline-offset: 2px; border-radius: 10px; }
/* The conversation rests on the dock, like a chat. */
.chat { flex: 1; justify-content: flex-end; }
.dock {
  position: sticky;
  bottom: 0;
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  margin-inline: calc(var(--page-gutter) * -1);
  padding: var(--space-3) var(--page-gutter) calc(var(--space-3) + var(--safe-bottom));
  border-top: 0.5px solid var(--separator);
  background: var(--bg);
}
progress { width: 100%; accent-color: var(--tint); }
.chat { display: flex; flex-direction: column; gap: var(--space-3); }
/* An empty conversation leaves the flow (no gap) but stays in the page, so its live region announces the first answer. */
.chat:not(:has(li, p)) { position: absolute; }
.messages { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.message { display: flex; align-items: flex-end; gap: var(--space-3); max-width: 90%; }
.message.is-user { align-self: flex-end; }
.avatar { flex: none; margin-block-end: 2px; }
.said { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; }
.bubble { margin: 0; padding: var(--space-3) var(--space-4); border-radius: var(--radius-bubble) var(--radius-bubble) var(--radius-bubble) 6px; background: var(--surface-2); white-space: pre-line; overflow-wrap: anywhere; }
.is-user .bubble { border-radius: 20px 20px 6px 20px; background: var(--tint-soft); color: var(--label); font-weight: 600; }
.failure-row { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
.failure { margin: 0; color: var(--danger-label); }
.composer { display: flex; flex-wrap: wrap; gap: var(--space-2); }
/* The hint stays whole: on a narrow screen the button drops to its own line instead of squeezing the field. */
.composer { align-items: center; }
.composer .input { flex: 1 1 12rem; min-width: 0; border-radius: 22px; padding-inline: var(--space-4); }
.composer > button { margin-inline-start: auto; }
/* The send circle (R_Asistente), named "Preguntar". */
.send { display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--tap-target); height: var(--tap-target); border: 0; border-radius: 50%; background: var(--tint); color: var(--tint-text); }
.send:disabled { background: var(--fill); color: var(--label-3); }
.privacy { display: flex; align-items: flex-start; gap: var(--space-1); }
.lock { flex: none; margin-top: 2px; }
.suggestions { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.suggestion { min-height: var(--tap-target); padding: var(--space-2) var(--space-4); border: 1px solid var(--field-border); border-radius: 12px; background: var(--surface); color: var(--label); font-weight: 600; text-align: start; transition: transform 0.1s var(--ease-out), opacity 0.1s; touch-action: manipulation; }
.suggestion:active:not(:disabled) { transform: scale(0.97); opacity: 0.85; }
.suggestion:disabled { opacity: 0.4; }
.notes { display: flex; flex-direction: column; gap: var(--space-1); }
.notes p { margin: 0; }
@media (prefers-reduced-motion: reduce) { .suggestion:active:not(:disabled) { transform: none; opacity: 0.7; } }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
