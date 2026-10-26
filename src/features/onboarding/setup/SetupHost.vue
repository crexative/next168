<script setup lang="ts">
import { computed, onBeforeUnmount, ref, shallowRef, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { PlannerDocument } from '@/core/model'
import { assertDocumentHash, CHANGED_ELSEWHERE, documentHash } from '@/features/insights/entryGuard'
import { documentFingerprint } from '@/repositories/storageCommit'
import { activePlannerRepository, usePlannerStore } from '@/stores/plannerStore'
import { announce } from '@/ui/announcer'
import Button from '@/ui/Button.vue'
import { anyModalOpen, openFullScreen } from '@/ui/sheetStack'
import { useUndoToast } from '@/ui/undoToast'
import {
  bindingFor, clearDismissed, clearDraft, draftOf, idsMatchBaseline, isDismissed, loadDraft, markDismissed, sameBinding, saveDraft, UNSAVED_WORKSPACE_KEY, type DraftBinding, type SetupDraft,
} from '../draftStorage'
import { setupOpen, setupRequest } from '../reopen'
import { applySetupPlan, planSetupCommit } from '../setupCommit'
import { nextScreen, partOf, sequence, TOTAL_PARTS } from '../setupFlow'
import {
  cloneState, createState, picksOf, prepareScreen, rangeProblem, roundIndex, type Issue, type ScreenId, type SetupEnv, type SetupState,
} from '../setupModel'
import { categoryFor } from './conversation'
import { TOPICS } from '../setupTopics'
import SetupConversation from './SetupConversation.vue'
import SetupFrame from './SetupFrame.vue'

// The guided setup's lifecycle: when it opens, what it is bound to, the draft that survives a reload, the single guarded
// commit at the end, and what happens when storage is no longer what the flow opened on. Closing never writes.
interface Baseline {
  document: PlannerDocument
  stored: boolean
  purgeEpoch: number | undefined
  hash: string
  fingerprint: string
  binding: DraftBinding
  workspaceKey: string
}

type Phase = 'closed' | 'screen' | 'conflict'

const { t } = useI18n()
const planner = usePlannerStore()
const undoToast = useUndoToast()
const env: SetupEnv = { topicName: (topic) => t(`onboarding.templates.${TOPICS[topic].nameKey}`) }

const phase = ref<Phase>('closed')
const flow = ref<SetupState | null>(null)
const baseline = shallowRef<Baseline | null>(null)
const submitting = ref(false)
const transitioning = ref(false)
const resumed = ref(false)
const reviewable = ref(false)
const issues = ref<Issue[]>([])
const message = ref('')
const draftUnavailable = ref(false)
const expanded = ref<string | null>(null)
let pristine = ''
let editing: { returnTo: ScreenId; seen: Set<ScreenId>; handled: Set<ScreenId>; problems: Set<string> } | null = null

const problemKey = (issue: Issue) => `${issue.categoryKey}:${issue.rangeKey}:${issue.code}:${issue.with?.categoryKey ?? ''}`

function problemsOn(state: SetupState, screen: ScreenId): Issue[] {
  const category = categoryFor(state, screen)
  return category?.ranges.flatMap((range) => {
    const issue = rangeProblem(state, category, range)
    return issue ? [issue] : []
  }) ?? []
}

const open = computed(() => phase.value !== 'closed')
// The frame owns the whole screen from the moment it is published, in the same synchronous step: nothing behind it
// (a sheet, a page heading, the sidebar) can take focus or act while it is open (sheetStack.ts).
let releaseFullScreen: (() => void) | undefined
watch(open, (value) => {
  setupOpen.value = value
  if (value) releaseFullScreen ??= openFullScreen()
  else {
    releaseFullScreen?.()
    releaseFullScreen = undefined
  }
}, { immediate: true, flush: 'sync' })
onBeforeUnmount(() => releaseFullScreen?.())
const locked = computed(() => submitting.value || transitioning.value)
const browserMode = computed(() => activePlannerRepository().saveGuarded !== undefined)
const dirty = computed(() => flow.value !== null && JSON.stringify(flow.value) !== pristine)
const part = computed(() => (phase.value === 'conflict' || !flow.value ? TOTAL_PARTS : partOf(flow.value.screen)))

// ---------- Baseline: what storage held when the flow opened ----------

function captureSync(): { document: PlannerDocument; stored: boolean; purgeEpoch: number | undefined } | null {
  if (planner.status !== 'ready' || !planner.document) return null
  // Everything that must describe the same moment is read before the first await.
  return { document: structuredClone(toRaw(planner.document)), stored: planner.stored, purgeEpoch: activePlannerRepository().knownPurgeEpoch?.() }
}

async function finishBaseline(raw: NonNullable<ReturnType<typeof captureSync>>): Promise<Baseline> {
  const fingerprint = raw.stored ? await documentFingerprint(raw.document) : 'absent'
  return { ...raw, hash: documentHash(raw.document)!, fingerprint, binding: bindingFor(raw.stored, raw.document, fingerprint), workspaceKey: raw.stored ? raw.document.workspaceId : UNSAVED_WORKSPACE_KEY }
}

function freshState(from: Baseline, at: 'sleep' | 'summary'): SetupState {
  const state = createState(from.document, env)
  state.screen = at
  if (at === 'sleep') prepareScreen(state, 'sleep', env)
  return state
}

function show(state: SetupState, from: Baseline): void {
  editing = null
  baseline.value = from
  flow.value = state
  pristine = JSON.stringify(freshState(from, 'sleep'))
  reviewable.value = from.document.blocks.length > 0
  expanded.value = null
  issues.value = []
  message.value = ''
  phase.value = 'screen'
}

// ---------- Opening ----------

function workspaceKeyNow(): string {
  return planner.stored && planner.document ? planner.document.workspaceId : UNSAVED_WORKSPACE_KEY
}

// Bumped by every storage error: an opening still waiting for its baseline is no longer about what storage holds.
let openGeneration = 0
watch(() => planner.status, (status) => { if (status === 'error') openGeneration += 1 }, { flush: 'sync' })

// The frame only opens over a usable planner with nothing else modal on screen. That is checked again after the
// baseline's await, right before the frame is published: a sheet or a storage error may have arrived meanwhile.
const mayOpen = () => planner.status === 'ready' && !!planner.document && !anyModalOpen()

async function openFlow(kind: 'auto' | 'entry'): Promise<void> {
  if (phase.value !== 'closed' || transitioning.value || !mayOpen()) return
  const raw = captureSync()
  if (!raw) return
  const generation = ++openGeneration
  transitioning.value = true
  try {
    const from = await finishBaseline(raw)
    if (generation !== openGeneration || !mayOpen()) return
    const draft = loadDraft()
    const matches = draft !== null && sameBinding(draft.binding, from.binding) && idsMatchBaseline(draft, from.document, from.stored)
    if (draft && matches) {
      show(restore(draft), from)
      resumed.value = true
    } else if (draft) {
      // The draft belongs to something storage no longer holds: say so once and show the week as it is now.
      clearDraft()
      show(freshState(from, 'summary'), from)
      phase.value = 'conflict'
    } else {
      if (draft) clearDraft()
      show(freshState(from, kind === 'entry' && from.document.blocks.length > 0 ? 'summary' : 'sleep'), from)
    }
  } finally {
    transitioning.value = false
  }
}

function restore(draft: SetupDraft): SetupState {
  const state: SetupState = { screen: draft.screen, answers: draft.answers, sleepSplit: draft.sleepSplit, categories: draft.categories, counter: draft.counter }
  if (draft.pending) state.pending = draft.pending
  return state
}

// A reload brings back a flow that was on screen; a first run opens by itself unless it was closed on this device.
function maybeOpenOnLoad(): void {
  if (phase.value !== 'closed' || planner.status !== 'ready' || !planner.document) return
  const draft = loadDraft()
  if (draft?.open) void openFlow('auto')
  else if (!planner.document.settings.onboardingDone && !isDismissed(workspaceKeyNow())) void openFlow('auto')
}

watch(() => [planner.status, planner.document?.settings.onboardingDone, planner.document?.workspaceId] as const, maybeOpenOnLoad, { immediate: true })
watch(setupRequest, () => { void openFlow('entry') })

// ---------- Draft ----------

watch(() => (flow.value ? JSON.stringify(flow.value) : ''), () => persist(), { flush: 'sync' })

function persist(): void {
  if (phase.value !== 'screen' || !flow.value || !baseline.value) return
  if (JSON.stringify(flow.value) === pristine) { clearDraft(); return }
  if (!saveDraft(draftOf(flow.value, baseline.value.binding, true))) draftUnavailable.value = true
}

function startOver(): void {
  if (!baseline.value) return
  clearDraft()
  show(freshState(baseline.value, 'sleep'), baseline.value)
}

// ---------- Moving ----------

function go(screen: ScreenId): void {
  if (!flow.value) return
  prepareScreen(flow.value, screen, env)
  flow.value.screen = screen
  // A name typed and not added belongs to the round it was typed on.
  delete flow.value.pending
  resumed.value = false
  issues.value = []
  message.value = ''
  expanded.value = null
}

function advance(): void {
  if (!flow.value) return
  if (editing) {
    const state = flow.value
    editing.handled.add(state.screen)
    const screens = sequence(state)
    const target = screens.includes(editing.returnTo) ? editing.returnTo : nextScreen(state, editing.returnTo)
    const pending = screens.slice(0, screens.indexOf(target)).find((screen) => {
      if (editing!.handled.has(screen)) return false
      // The round after the last pick is still open: "Anything else?" is asked before going back.
      const round = roundIndex(screen)
      if (round !== undefined) return state.answers.more !== null && round === picksOf(state).length && !state.answers.moreDone
      if (problemsOn(state, screen).some((issue) => !editing!.problems.has(problemKey(issue)))) return true
      if (editing!.seen.has(screen)) return false
      const category = categoryFor(state, screen)
      if (category) return !category.suggested || category.ranges.some((range) => !range.accepted)
      if (['sleep', 'work', 'study', 'commuteRanges', 'exerciseRanges'].includes(screen) || screen.startsWith('extra:')) return true
      return screen === 'commute' ? state.answers.commute === 'unanswered' : screen === 'exercise' && state.answers.exercise === 'unanswered'
    })
    if (pending) { go(pending); return }
    editing = null
    go(target)
    return
  }
  go(nextScreen(flow.value))
}

// Tapping an earlier answer opens that question again; the answers after it stay (dormant when they no longer apply).
function jump(screen: ScreenId): void {
  if (locked.value || !flow.value) return
  const state = flow.value
  const screens = sequence(state)
  editing ??= {
    returnTo: state.screen,
    seen: new Set(screens.slice(0, screens.indexOf(state.screen))),
    handled: new Set(),
    problems: new Set(screens.flatMap((screen) => problemsOn(state, screen).map(problemKey))),
  }
  go(screen)
}

function review(): void {
  editing = null
  go('sleep')
}

// ---------- Closing: never writes ----------

function closeFlow(): void {
  if (locked.value || phase.value === 'closed') return
  if (flow.value && baseline.value) {
    if (JSON.stringify(flow.value) === pristine) clearDraft()
    else saveDraft(draftOf(flow.value, baseline.value.binding, false))
    markDismissed(baseline.value.workspaceKey)
  }
  phase.value = 'closed'
  flow.value = null
}

// ---------- Saving: one guarded commit on a frozen snapshot ----------

function finishSaved(first: boolean): void {
  clearDraft()
  clearDismissed()
  undoToast.dismiss()
  announce(t('onboarding.summary.saved'))
  phase.value = 'closed'
  flow.value = null
  submitting.value = false
  // A first setup lands on Today, where the week it just made begins.
  if (first) window.location.hash = '#/today'
}

async function submit(): Promise<void> {
  if (locked.value || !flow.value || !baseline.value) return
  const from = baseline.value
  const snapshot = cloneState(flow.value)
  const planned = planSetupCommit(snapshot, from.document, () => crypto.randomUUID())
  if (planned.kind === 'invalid') {
    issues.value = planned.issues
    message.value = ''
    focusFirstIssue(planned.issues)
    return
  }
  if (planned.kind === 'tooLarge') {
    message.value = t('onboarding.summary.tooLarge')
    return
  }
  submitting.value = true
  if (planned.empty) {
    finishSaved(false)
    return
  }
  const result = await planner.commit((draft) => {
    assertDocumentHash(draft, from.hash)
    applySetupPlan(draft, planned.plan)
  }, { expect: { storedFingerprint: from.fingerprint, purgeEpoch: from.purgeEpoch } })
  if (result.ok) {
    finishSaved(planned.plan.onboardingDone)
  } else if (result.reason === 'conflict' || result.reason === CHANGED_ELSEWHERE) {
    await showCurrentWeek()
  } else {
    // A failure of the storage itself: the draft stays and the person can try again.
    message.value = t('onboarding.summary.saveFailed')
    planner.dismissError()
    submitting.value = false
  }
}

function focusFirstIssue(list: Issue[]): void {
  const first = list[0]
  if (!first || !flow.value) return
  expanded.value = first.categoryKey
  announce(first.code === 'nameRequired' || first.code === 'nameDuplicate' ? t(`onboarding.guided.errors.${first.code}`) : t('onboarding.guided.errors.overlap', { name: '', when: '' }))
}

// Storage is no longer what the flow opened on. Nothing is written: the draft is dropped, the planner is reloaded, and
// only a usable reload reopens the flow, with every binding rebuilt together from what was loaded.
async function showCurrentWeek(): Promise<void> {
  transitioning.value = true
  clearDraft()
  planner.dismissError()
  await planner.load()
  const raw = captureSync()
  if (raw) {
    const from = await finishBaseline(raw)
    show(freshState(from, 'summary'), from)
    phase.value = 'conflict'
  } else {
    // A failed, corrupt, unsupported or read-only reload keeps the existing error screen.
    phase.value = 'closed'
    flow.value = null
  }
  transitioning.value = false
  submitting.value = false
}

function understood(): void {
  phase.value = 'screen'
}

// ---------- A field in view when the keyboard opens ----------

function scrollFocusedIntoView(): void {
  const active = document.activeElement as HTMLElement | null
  if (active?.closest('[data-testid=setup]') && active.matches('input, textarea')) active.scrollIntoView({ block: 'center' })
}

const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
viewport?.addEventListener('resize', scrollFocusedIntoView)
onBeforeUnmount(() => viewport?.removeEventListener('resize', scrollFocusedIntoView))
</script>

<template>
  <SetupFrame
    :open="open" :title="t('onboarding.guided.sheetTitle')" :close-label="t('onboarding.guided.close')"
    :progress-label="t('onboarding.guided.progress', { step: part, total: TOTAL_PARTS })"
    :count-label="t('onboarding.guided.progressShort', { step: part, total: TOTAL_PARTS })" :part="part" :total="TOTAL_PARTS" :locked="locked" :dirty="dirty"
    @close="closeFlow"
  >
    <div class="setup-lock" :inert="locked || undefined">
      <div v-if="phase === 'conflict'" class="setup conflict" data-testid="setup" data-state="conflict">
        <div class="conflict-column">
          <p class="t-title-2" role="alert" data-testid="changed-elsewhere">{{ t('onboarding.summary.changedElsewhere') }}</p>
          <Button data-primary data-setup-initial-focus data-testid="understood" @click="understood">{{ t('onboarding.summary.understood') }}</Button>
        </div>
      </div>
      <div v-else-if="flow && baseline" class="setup" data-testid="setup" :data-screen="flow.screen" :aria-busy="locked || undefined">
        <SetupConversation
          v-model:expanded="expanded" :state="flow" :document="baseline.document" :first="!baseline.document.settings.onboardingDone" :reviewable="reviewable"
          :issues="issues" :busy="locked" :message="message" :show-trust="browserMode" :resumed="resumed" :draft-unavailable="draftUnavailable"
          @advance="advance" @jump="jump" @submit="submit" @review="review" @edited="issues = []" @start-over="startOver"
        />
      </div>
    </div>
  </SetupFrame>
</template>

<style scoped>
/* While a save is pending the whole flow is inert: nothing in it can be pressed, typed into or focused. */
.setup-lock, .setup { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.conflict-column {
  box-sizing: border-box; display: flex; flex-direction: column; align-items: flex-start; gap: var(--space-4); width: 100%; max-width: var(--column);
  margin-inline: auto; padding: var(--space-6) max(var(--space-4), var(--safe-right)) var(--space-6) max(var(--space-4), var(--safe-left));
}
.conflict-column p { margin: 0; }
</style>
