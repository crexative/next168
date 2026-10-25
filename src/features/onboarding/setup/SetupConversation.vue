<script setup lang="ts">
import { computed, nextTick, onMounted, ref, useId, watch } from 'vue'
import type { PlannerDocument } from '@/core/model'
import Button from '@/ui/Button.vue'
import { prefersReducedMotion } from '@/ui/useMediaQuery'
import type { Issue, ScreenId, SetupState } from '../setupModel'
import AppMark from './AppMark.vue'
import { answer, hint, question, transcript, type Line } from './conversation'
import SetupAnswer from './SetupAnswer.vue'
import SetupSummary from './SetupSummary.vue'
import { useSetupFormat } from './useSetupFormat'

// The guided setup as a conversation: Next168's questions on the leading side, the person's answers on the trailing
// side, every earlier answer still there and tappable to change it, and the answers for the current question docked
// at the bottom. The last message is the week itself, editable in place.
const props = defineProps<{
  state: SetupState
  document: PlannerDocument
  first: boolean
  reviewable: boolean
  issues: Issue[]
  busy: boolean
  message: string
  showTrust: boolean
  resumed: boolean
  draftUnavailable: boolean
}>()
const emit = defineEmits<{ advance: []; jump: [screen: ScreenId]; submit: []; review: []; edited: []; startOver: [] }>()
const expanded = defineModel<string | null>('expanded', { default: null })
const { t, rangeLine } = useSetupFormat()
const speaker = { t: (key: string, params?: Record<string, unknown>) => t(key, params ?? {}), rangeLine }

const scroller = ref<HTMLElement | null>(null)
const dock = ref<InstanceType<typeof SetupAnswer> | null>(null)

// Enter on anything that is not itself a control (the question, the conversation) sends the answer on show.
function onEnter(event: KeyboardEvent): void {
  if (event.isComposing || (event.target as HTMLElement).closest('button, a, input, textarea, select, [role=button]')) return
  event.preventDefault()
  dock.value?.send()
}
const heading = ref<HTMLElement | null>(null)
const screen = computed(() => props.state.screen)
const summary = computed(() => screen.value === 'summary')
const say = (line: Line | undefined) => (line ? t(line.key, line.params ?? {}) : '')

const exchanges = computed(() => transcript(props.state, props.reviewable).map((past) => {
  const reply = answer(props.state, past, speaker)
  return { screen: past, question: say(question(props.state, past)), answer: reply, label: t('onboarding.guided.change', { question: say(question(props.state, past)), answer: reply.replace(/\n/g, ', ') }) }
}))
const now = computed(() => ({ question: say(question(props.state, screen.value)), hint: say(hint(props.state, screen.value)) }))

const questionId = useId()

// When the setup opens, focus rests on the question, with no focus ring lit by itself. After each answer it moves to
// the next answer's control (described by its question), so the next reply needs no extra tap. The conversation shows
// as much of what led to the question as fits, never scrolling the question itself out of view.
async function reveal(arriving: boolean): Promise<void> {
  await nextTick()
  if (arriving || summary.value || !(await dock.value?.focusAnswer())) heading.value?.focus({ preventScroll: true })
  const element = scroller.value
  const current = element?.querySelector<HTMLElement>('.exchange.is-current')
  if (!element || !current) return
  const top = Math.max(0, Math.min(element.scrollHeight - element.clientHeight, current.offsetTop - 16))
  element.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
}

onMounted(() => reveal(true))
watch(screen, () => reveal(false), { flush: 'post' })

function onFocusIn(event: FocusEvent): void {
  const target = event.target as HTMLElement
  if (target.matches('input, textarea')) requestAnimationFrame(() => target.scrollIntoView({ block: 'center' }))
}
</script>

<template>
  <section class="screen" :aria-busy="busy || undefined" @focusin="onFocusIn" @keydown.enter="onEnter">
    <div ref="scroller" class="setup-scroller">
      <div class="column">
        <p v-if="draftUnavailable" class="t-body note" role="status" data-testid="draft-unavailable">{{ t('onboarding.guided.draftUnavailable') }}</p>
        <TransitionGroup tag="ol" name="say" class="transcript" role="log" :aria-label="t('onboarding.guided.conversation')">
          <li v-for="exchange in exchanges" :key="exchange.screen" class="exchange is-past" :data-exchange="exchange.screen">
            <button class="turn" type="button" :data-answer="exchange.screen" :aria-label="exchange.label" :disabled="busy" @click="emit('jump', exchange.screen)">
              <span class="turn-question t-subhead">{{ exchange.question }}</span>
              <span class="turn-answer">{{ exchange.answer }}</span>
            </button>
          </li>
          <li :key="screen" class="exchange is-current" :data-exchange="screen">
            <div class="from-app">
              <AppMark class="avatar" :size="36" />
              <div class="bubble question is-current">
                <h3 :id="questionId" ref="heading" class="ask" tabindex="-1" data-setup-initial-focus>{{ now.question }}</h3>
                <p v-if="now.hint" class="hint t-body">{{ now.hint }}</p>
              </div>
            </div>
          </li>
        </TransitionGroup>
        <div v-if="resumed" class="resumed">
          <p class="t-body" role="status">{{ t('onboarding.guided.resumed') }}</p>
          <Button variant="plain" data-testid="start-over" @click="emit('startOver')">{{ t('onboarding.guided.startOver') }}</Button>
        </div>
        <p v-if="screen === 'sleep' && showTrust" class="trust t-body" data-testid="setup-trust">{{ t('onboarding.guided.trust') }}</p>
        <Transition name="say" appear>
          <SetupSummary
            v-if="summary" v-model:expanded="expanded" :state="state" :document="document" :reviewable="reviewable" :issues="issues" :message="message"
            :show-trust="showTrust" @review="emit('review')" @edited="emit('edited')"
          />
        </Transition>
      </div>
    </div>

    <footer v-if="summary" class="dock">
      <div class="column actions">
        <Button data-primary data-dock-primary data-testid="setup-primary" block :disabled="busy" @click="emit('submit')">{{ first ? t('onboarding.summary.start') : t('onboarding.summary.save') }}</Button>
      </div>
    </footer>
    <SetupAnswer v-else ref="dock" :key="screen" :state="state" :busy="busy" :group-label="now.question" :question-id="questionId" @advance="emit('advance')" @edited="emit('edited')" />
  </section>
</template>

<style scoped>
.screen { display: flex; flex: 1; flex-direction: column; min-height: 0; hyphens: auto; }
.screen :deep(button) { hyphens: manual; }
.setup-scroller { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.column { box-sizing: border-box; width: 100%; max-width: var(--column); margin-inline: auto; padding-inline: max(var(--page-gutter), var(--safe-left)) max(var(--page-gutter), var(--safe-right)); }
.setup-scroller > .column { display: flex; flex-direction: column; gap: var(--space-4); padding-block: var(--space-4) var(--space-6); }
.transcript { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.exchange { display: flex; flex-direction: column; }
.exchange.is-current { margin-block-start: var(--space-3); }
.from-app { display: flex; align-items: center; gap: var(--space-3); }
.avatar { margin-block-end: 2px; }
/* Answered turns: a compact log, the question small and quiet, the answer bold; each one opens its question again. */
.turn {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%; min-height: var(--tap-target); margin: 0; padding: var(--space-1) 0;
  border: 0; border-radius: var(--radius-control); background: transparent; color: var(--label); text-align: start; touch-action: manipulation;
  transition: opacity 0.1s;
}
.turn:hover:not(:disabled) .turn-answer { color: var(--tint-label); }
.turn:active:not(:disabled) { opacity: 0.6; }
.turn:focus-visible { outline-offset: -2px; }
.turn-question { color: var(--label-2); overflow-wrap: anywhere; }
.turn-answer { font-size: 1.1875rem; line-height: 1.3; font-weight: 700; white-space: pre-line; overflow-wrap: anywhere; }
.bubble { box-sizing: border-box; margin: 0; padding: var(--space-4) var(--space-5); overflow-wrap: anywhere; }
/* Only the current question is a bubble, next to Next168's mark. */
.question { flex: 1 1 auto; min-width: 0; border-radius: 22px 22px 22px 6px; background: var(--surface-2); color: var(--label); }
.ask, .hint { hyphens: manual; text-wrap: pretty; }
.ask { margin: 0; font-size: 1.375rem; line-height: 1.27; font-weight: 700; letter-spacing: -0.01em; outline: none; }
.hint { margin: var(--space-1) 0 0; color: var(--label-2); }
.note, .trust { margin: 0; color: var(--label-2); }
.trust { padding-inline-start: calc(36px + var(--space-3)); }
.resumed { display: flex; flex-wrap: wrap; align-items: center; justify-content: center; column-gap: var(--space-3); text-align: center; }
.resumed p { margin: 0; color: var(--label-2); }
.dock { flex: none; border-top: 0.5px solid var(--separator); background: var(--surface); }
.actions { display: flex; justify-content: center; padding-block: var(--group-gap) calc(var(--space-4) + var(--safe-bottom)); }
.actions :deep(.ui-button) { width: 100%; min-height: 52px; border-radius: 26px; overflow-wrap: anywhere; hyphens: auto; }

/* A new message arrives calmly from just below; without motion it only fades in. */
.say-enter-active { transition: opacity 0.3s var(--ease-out), transform var(--spring-duration) var(--ease-out); }
.say-enter-from { opacity: 0; transform: translateY(12px); }
.say-leave-active { display: none; }
@media (prefers-reduced-motion: reduce) {
  .say-enter-active { transition: opacity 0.2s; }
  .say-enter-from { transform: none; }
  }
</style>
