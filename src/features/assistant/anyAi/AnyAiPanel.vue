<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import { expandCalendarSources } from '@/features/calendars/occurrenceSource'
import { openProposalReview } from '@/features/proposals'
import { getProposalRepository } from '@/features/proposals/repository'
import { refreshPending } from '@/features/proposals/pending'
import { lastDecision } from '@/features/proposals/reviewState'
import { localDateOf } from '@/core/time'
import { MAX_OPS_PER_PROPOSAL, type ExternalOccurrence } from '@/core/model'
import { weekDates } from '@/features/week/localTime'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { buildAiPrompt } from './buildPrompt'
import { copyText } from './copyText'
import { reviewReply, type ReplyFailure } from './reviewReply'

// Plan with ChatGPT, Claude, Gemini or any chat AI by copy and paste. The AI never touches the plan: its answer
// becomes a proposal that the person reviews and approves in the same sheet as every other proposal.
const props = withDefaults(defineProps<{ collapsible?: boolean }>(), { collapsible: false })

const { t, locale } = useI18n()
const planner = usePlannerStore()
const ids = { title: useId(), body: useId(), paste: useId(), hint: useId() }

const open = ref(!props.collapsible)
const reply = ref('')
const busy = ref(false)
const copied = ref<'idle' | 'copied' | 'manual'>('idle')
const manualText = ref('')
const failure = ref<ReplyFailure | null>(null)
const failureDetail = ref('')
// The proposal made from the pasted reply. The reply stays in the box until that proposal is approved, so a person who
// cancels the review can read it again or review it once more without going back to the chat.
const reviewedId = ref<string | null>(null)
const manual = ref<HTMLTextAreaElement | null>(null)
const external = ref<ExternalOccurrence[]>([])

// Imported calendars are read ahead of the click, so the prompt is built inside the gesture that copies it
// (some browsers refuse to copy once an asynchronous read has happened in between). Copying waits until the read
// for the plan as it is now has finished: a prompt must never go out without the meetings it should list.
const planKey = (document: { workspaceId: string; revision: number } | null) => (document ? `${document.workspaceId}@${document.revision}` : null)
const calendarsReadFor = ref<string | null>(null)
let generation = 0
watch(() => [planner.document?.workspaceId, planner.document?.revision, planner.document?.calendarSources] as const, async () => {
  const current = ++generation
  const document = planner.document
  calendarsReadFor.value = null
  if (!document) { external.value = []; return }
  const key = planKey(document)
  if (document.calendarSources.length === 0) { external.value = []; calendarsReadFor.value = key; return }
  const timeZone = document.settings.timeZone
  const fromDate = weekDates(localDateOf(new Date(), timeZone), document.settings.weekStartsOn)[0]!
  const expanded = await expandCalendarSources({ fromDate, days: 7, timeZone }).catch(() => [])
  if (current !== generation) return
  external.value = expanded
  calendarsReadFor.value = key
}, { immediate: true })

const calendarsReady = computed(() => !!planner.document && calendarsReadFor.value === planKey(planner.document))
const canCopy = computed(() => calendarsReady.value)
const canReview = computed(() => !!planner.document && planner.writable && !!reply.value.trim() && !busy.value)
const retryable = computed(() => failure.value === 'stale' || failure.value === 'wrongWorkspace' || failure.value === 'invalid' || failure.value === 'unusable' || failure.value === 'duplicateCategory')
const noCategories = computed(() => planner.document?.categories.length === 0)
const failureText = computed(() => failure.value && t(`connect.anyAi.errors.${failure.value}`, { count: failureDetail.value, max: MAX_OPS_PER_PROPOSAL, name: failureDetail.value }))

// The first lines of a reply that held no changes: often the AI asked a question or explained why it could not.
const REPLY_START_LINES = 3
const REPLY_START_CHARS = 240
const replyStart = computed(() => {
  if (failure.value !== 'none') return ''
  const lines = reply.value.trim().split(/\n+/).map((line) => line.trim()).filter(Boolean).slice(0, REPLY_START_LINES).join('\n')
  return [...lines].length > REPLY_START_CHARS ? `${[...lines].slice(0, REPLY_START_CHARS - 1).join('')}…` : lines
})

async function copy(): Promise<void> {
  const document = planner.document
  if (!document || !calendarsReady.value) return
  const text = buildAiPrompt({
    document, now: new Date(), locale: locale.value, external: external.value,
    translate: (key, params) => t(key, params ?? {}),
  })
  failure.value = null
  if (await copyText(text)) { copied.value = 'copied'; manualText.value = ''; return }
  copied.value = 'manual'; manualText.value = text
  await nextTick()
  manual.value?.focus(); manual.value?.select()
}

async function review(): Promise<void> {
  const document = planner.document
  if (!document || busy.value) return
  busy.value = true; failure.value = null
  try {
    const outcome = await reviewReply(reply.value, document, getProposalRepository())
    if (!outcome.ok) { failure.value = outcome.reason; failureDetail.value = outcome.detail ?? ''; return }
    reviewedId.value = outcome.proposal.id
    await refreshPending().catch(() => undefined)
    openProposalReview(outcome.proposal, { pastedReply: true })
  } finally { busy.value = false }
}

watch(reply, () => { failure.value = null })
watch(lastDecision, (decision) => {
  if (decision?.kind === 'applied' && decision.id === reviewedId.value) { reply.value = ''; reviewedId.value = null }
})
</script>

<template>
  <section class="any-ai" data-testid="any-ai" :aria-labelledby="ids.title">
    <component :is="collapsible ? 'button' : 'div'" class="head" :type="collapsible ? 'button' : undefined" :aria-expanded="collapsible ? open : undefined" :aria-controls="collapsible ? ids.body : undefined" data-testid="any-ai-toggle" @click="collapsible && (open = !open)">
      <span class="head-text">
        <span :id="ids.title" class="t-headline">{{ t('connect.anyAi.title') }}</span>
        <span class="t-subhead t-secondary">{{ t('connect.anyAi.subtitle') }}</span>
      </span>
      <Icon v-if="collapsible" name="chevron-right" :size="18" class="chevron" :class="{ 'is-open': open }" />
    </component>

    <div v-if="open" :id="ids.body" class="body">
      <ol class="steps t-subhead">
        <li>{{ t('connect.anyAi.steps.copy') }}</li>
        <li>{{ t('connect.anyAi.steps.chat') }}</li>
        <li>{{ t('connect.anyAi.steps.paste') }}</li>
      </ol>
      <p v-if="noCategories" class="t-subhead empty-hint" data-testid="any-ai-empty-hint">{{ t('connect.anyAi.emptyHint') }}</p>

      <div class="group">
        <Button :disabled="!canCopy" data-testid="any-ai-copy" @click="copy">{{ t('connect.anyAi.copy') }}</Button>
        <p v-if="planner.document && !calendarsReady" class="t-footnote t-secondary" role="status" data-testid="any-ai-calendars-loading">{{ t('connect.anyAi.loadingCalendars') }}</p>
        <p v-if="copied === 'copied'" class="t-footnote t-secondary" role="status" data-testid="any-ai-copied">{{ t('connect.anyAi.copied') }}</p>
        <template v-if="copied === 'manual'">
          <p class="t-footnote t-secondary" role="status">{{ t('connect.anyAi.manual') }}</p>
          <label class="sr-only" :for="`${ids.paste}-manual`">{{ t('connect.anyAi.manualLabel') }}</label>
          <textarea :id="`${ids.paste}-manual`" ref="manual" class="input t-footnote field" rows="8" readonly data-testid="any-ai-manual" :value="manualText" @focus="($event.target as HTMLTextAreaElement).select()" />
        </template>
      </div>

      <div class="group">
        <label class="t-headline" :for="ids.paste">{{ t('connect.anyAi.pasteLabel') }}</label>
        <textarea :id="ids.paste" v-model="reply" class="input t-body field paste" rows="6" spellcheck="false" :aria-describedby="failure ? `${ids.hint}-error` : ids.hint" :aria-invalid="failure ? 'true' : undefined" :placeholder="t('connect.anyAi.pastePlaceholder')" data-testid="any-ai-paste" />
        <p :id="ids.hint" class="t-footnote t-secondary">{{ t('connect.anyAi.safety') }}</p>
        <div v-if="failure" :id="`${ids.hint}-error`" class="error" role="alert" data-testid="any-ai-error">
          <Icon name="triangle-alert" :size="20" class="error-icon" />
          <div class="error-text">
            <p class="t-subhead">{{ failureText }}</p>
            <template v-if="replyStart">
              <p class="t-footnote t-secondary">{{ t('connect.anyAi.replyStart') }}</p>
              <blockquote class="reply-start t-footnote" data-testid="any-ai-reply-start">{{ replyStart }}</blockquote>
            </template>
            <Button v-if="retryable" variant="tinted" :disabled="!canCopy" data-testid="any-ai-copy-again" @click="copy">{{ t('connect.anyAi.copyAgain') }}</Button>
          </div>
        </div>
        <Button :disabled="!canReview" data-testid="any-ai-review" @click="review">{{ t('connect.anyAi.review') }}</Button>
      </div>
    </div>
  </section>
</template>

<style scoped>
.any-ai { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--card-padding); background: var(--surface); border-radius: var(--radius-card); }
.head { display: flex; align-items: center; gap: var(--space-3); width: 100%; min-height: var(--tap-target); padding: 0; border: 0; background: transparent; color: var(--label); text-align: start; }
button.head { touch-action: manipulation; }
button.head:active { opacity: 0.6; }
.head-text { display: flex; flex: 1; flex-direction: column; gap: var(--space-1); min-width: 0; overflow-wrap: anywhere; }
.chevron { flex: none; color: var(--label-3); }
.chevron.is-open { transform: rotate(90deg); }
.body { display: flex; flex-direction: column; gap: var(--space-4); }
.steps li { overflow-wrap: anywhere; }
.any-ai :deep(.ui-button) { overflow-wrap: anywhere; }
.steps { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding-inline-start: var(--space-5); }
.group { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); }
.group > p, .group > label { margin: 0; overflow-wrap: anywhere; }
.field { width: 100%; padding: var(--space-3); resize: vertical; }
.error { display: flex; align-items: flex-start; gap: var(--space-2); width: 100%; padding: var(--space-3); border-radius: var(--radius-control); background: color-mix(in srgb, var(--danger) 14%, var(--surface)); }
.error-icon { flex: none; margin-top: 1px; }
.error-text { display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-2); min-width: 0; }
.error-text p { margin: 0; overflow-wrap: anywhere; }
.empty-hint { margin: 0; overflow-wrap: anywhere; }
/* The AI's own words, set apart from the app's message by an edge rather than by colour alone. */
.reply-start { margin: 0; padding-inline-start: var(--space-3); border-inline-start: 3px solid var(--separator); white-space: pre-line; overflow-wrap: anywhere; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
</style>
