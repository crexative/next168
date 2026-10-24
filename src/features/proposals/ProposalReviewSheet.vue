<script setup lang="ts">
import { computed, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { previewProposal, type ProposalPreview } from '@/core/proposals'
import { failureReason, isStorageFailure } from '@/repositories/storageCommit'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import Sheet from '@/ui/Sheet.vue'
import { refreshPending } from './pending'
import { getProposalRepository } from './repository'
import { summarizeEntity } from './changeSummary'
import { EXPANDED_UP_TO, groupChanges, type ChangeGroupKey } from './changeGroups'
import { lastDecision, reviewing, type ProposalReview } from './reviewState'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const repository = getProposalRepository()
const groupId = useId()
const preview = ref<ProposalPreview>()
const open = ref(false)
const busy = ref(false)
const message = ref('')
// True once the proposal on screen needs nothing more from this sheet: decided here, or left pending on purpose.
let settled = false
// The raw change is only put on the page while it is asked for.
const rawOpen = ref(new Set<number>())
function toggleRaw(index: number): void {
  const next = new Set(rawOpen.value)
  if (!next.delete(index)) next.add(index)
  rawOpen.value = next
}
const groups = computed(() => groupChanges(preview.value?.changes ?? []))
const expanded = ref(new Set<ChangeGroupKey>())
function toggleGroup(key: ChangeGroupKey): void {
  const next = new Set(expanded.value)
  if (!next.delete(key)) next.add(key)
  expanded.value = next
}
const overview = computed(() => groups.value.map((group) => t(`proposals.counts.${group.key}`, { count: group.changes.length }, group.changes.length)).join(' · '))
// A proposal made from a pasted reply exists only for this review: cancelling discards it, and the reply is still in
// the paste box. Proposals from a connected assistant stay pending in Proposals until they are decided.
const pasted = computed(() => reviewing.value?.pastedReply === true)
const invalidText = computed(() => {
  const [code, ...detail] = (preview.value?.reason ?? '').split(':')
  if (code === 'proposal.staleRevision') return t('proposals.stale')
  if (code === 'proposal.duplicateCategory') return t('proposals.duplicateCategory', { name: detail.join(':') })
  return t('proposals.invalid')
})
// New categories are named from the preview, so a routine in one reads with its name, not "Unknown category".
const summaryContext = computed(() => ({
  categories: preview.value?.categories ?? planner.document?.categories ?? [],
  locale: locale.value,
  timeZone: planner.document?.settings.timeZone ?? 'UTC',
  t: (key: string, params?: Record<string, unknown>) => t(key, params ?? {}),
}))
const summarize = (value: unknown) => summarizeEntity(value, summaryContext.value)

async function discardIfPasted(proposal: ProposalReview): Promise<void> {
  if (!proposal.pastedReply) return
  // If this fails the proposal stays pending and listed in Proposals, where it can still be decided.
  try { await repository.reject(proposal.id); await refreshPending() } catch { /* see above */ }
}

// The sheet is mounted outside the shell, so the storage error screen cannot cover it: it closes instead, and the
// proposal stays as it is (nothing can be written while storage fails).
watch(() => planner.status, (status) => { if (status === 'error') { settled = true; open.value = false } })

watch(open, (isOpen) => {
  if (!isOpen && !settled && reviewing.value) { settled = true; void discardIfPasted(reviewing.value) }
})

watch(reviewing, async (proposal, previous) => {
  if (!proposal) return
  if (previous && open.value && !settled) void discardIfPasted(previous)
  settled = false
  preview.value = undefined; message.value = ''; rawOpen.value = new Set(); expanded.value = new Set(); open.value = true
  await planner.load()
  if (!planner.document || planner.status !== 'ready' || reviewing.value !== proposal) return
  const result = await previewProposal(planner.document, proposal)
  if (reviewing.value !== proposal) return
  preview.value = result
  expanded.value = result.changes.length <= EXPANDED_UP_TO ? new Set(groupChanges(result.changes).map((group) => group.key)) : new Set()
})

async function decide(approve: boolean) {
  const proposal = reviewing.value
  if (!proposal || busy.value) return
  busy.value = true; message.value = ''
  try {
    const result = approve ? await repository.approve(proposal.id, proposal.contentHash, proposal.baseRevision) : await repository.reject(proposal.id)
    if (result.kind === 'stale') {
      message.value = t('proposals.stale')
      if (preview.value) preview.value.valid = false
    } else if (result.kind === 'applied' || result.kind === 'rejected') {
      settled = true
      await planner.load()
      await refreshPending().catch(() => undefined)
      lastDecision.value = { kind: result.kind, id: proposal.id, tick: (lastDecision.value?.tick ?? 0) + 1 }
      open.value = false
    } else message.value = t('proposals.notFound')
  } catch (failure) {
    const reason = failureReason(failure)
    // Nothing was written (the approval is one transaction); the planner blocks editing until storage works.
    if (isStorageFailure(reason)) planner.reportStorageFailure(reason)
    else message.value = t('proposals.decisionError')
  }
  finally { busy.value = false }
}
</script>

<template>
  <Sheet v-model:open="open" :title="t('proposals.review')">
    <div v-if="reviewing" class="review" data-testid="proposal-review">
      <header class="review-head">
        <p class="t-headline">{{ reviewing.summary }}</p>
        <p v-if="overview" class="t-subhead overview" data-testid="review-overview">{{ overview }}</p>
        <p class="t-footnote t-secondary">{{ t('proposals.revision', { revision: reviewing.baseRevision }) }}</p>
        <p class="t-footnote t-secondary" data-testid="review-cancel-note">{{ t(pasted ? 'proposals.discardOnCancel' : 'proposals.keepOnCancel') }}</p>
      </header>
      <p v-if="!preview" class="t-subhead t-secondary" role="status" data-testid="review-loading">{{ t('proposals.loading') }}</p>
      <p v-else-if="!preview.valid" class="notice is-error t-subhead" role="alert" data-testid="review-invalid">
        <Icon name="triangle-alert" :size="20" class="notice-icon" />
        <span>{{ invalidText }}</span>
      </p>
      <ul v-if="preview?.warnings.length" class="warnings" aria-live="polite">
        <li v-for="warning in preview.warnings" :key="warning" class="notice t-subhead">
          <Icon name="triangle-alert" :size="20" class="notice-icon" />
          <span>{{ t(warning.startsWith('goal.over:') ? 'proposals.overGoal' : 'proposals.overlap') }}</span>
        </li>
      </ul>
      <section v-for="group in groups" :key="group.key" class="group" :data-testid="`review-group-${group.key}`">
        <button class="group-toggle" type="button" :aria-expanded="expanded.has(group.key)" :aria-controls="`${groupId}-${group.key}`" @click="toggleGroup(group.key)">
          <span class="t-headline group-name">{{ t(`proposals.groups.${group.key}`) }}</span>
          <span class="t-subhead t-secondary group-count">{{ group.changes.length }}</span>
          <Icon name="chevron-right" :size="18" class="chevron" :class="{ 'is-open': expanded.has(group.key) }" />
        </button>
        <ul v-if="expanded.has(group.key)" :id="`${groupId}-${group.key}`" class="changes">
          <li v-for="{ index, change } in group.changes" :key="index" class="change">
            <h3 class="t-headline">{{ t(`proposals.operations.${change.op}`) }}</h3>
            <div class="diff">
              <section v-for="side in (['before', 'after'] as const)" :key="side" class="side" :class="`is-${side}`" :aria-label="t(`proposals.${side}`)">
                <h4 class="t-caption t-secondary">{{ t(`proposals.${side}`) }}</h4>
                <dl v-if="summarize(change[side]).length" class="summary" :data-testid="`change-${side}`">
                  <template v-for="row in summarize(change[side])" :key="row.label"><dt class="t-footnote t-secondary">{{ row.label }}</dt><dd class="t-subhead">{{ row.value }}</dd></template>
                </dl>
                <p v-else class="t-subhead t-secondary">{{ t('proposals.nothing') }}</p>
              </section>
            </div>
            <div class="raw">
              <button class="raw-toggle t-footnote" type="button" :aria-expanded="rawOpen.has(index)" @click="toggleRaw(index)">{{ t('proposals.details') }}</button>
              <pre v-if="rawOpen.has(index)">{{ JSON.stringify({ before: change.before, after: change.after }, null, 2) }}</pre>
            </div>
          </li>
        </ul>
      </section>
      <p v-if="message" class="t-subhead" role="status">{{ message }}</p>
      <Button v-if="!pasted" class="reject" variant="plain" destructive :disabled="busy" @click="decide(false)">{{ t('proposals.reject') }}</Button>
    </div>
    <template #footer>
      <div class="actions">
        <Button :disabled="busy || !preview?.valid" data-testid="review-approve" @click="decide(true)">{{ t('proposals.approve') }}</Button>
        <Button variant="plain" :disabled="busy" data-testid="review-cancel" @click="open = false">{{ t('proposals.cancel') }}</Button>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.review { display: flex; flex-direction: column; gap: var(--space-4); }
.review-head { display: flex; flex-direction: column; gap: var(--space-1); }
.review-head p { margin: 0; overflow-wrap: anywhere; }
.changes { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; }
.change { padding: var(--space-3); background: var(--surface-2); border-radius: var(--radius-card); }
.change > * + * { margin-top: var(--space-2); }
.change h3 { margin: 0; }
.diff { display: grid; gap: var(--space-2); grid-template-columns: minmax(0, 1fr); }
.side { display: flex; flex-direction: column; gap: var(--space-1); padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--surface); }
.side h4 { margin: 0; text-transform: uppercase; }
/* What the change leaves behind carries a tint edge, so before and after read apart without colour alone (the heading names them). */
.side.is-after { box-shadow: inset 3px 0 0 var(--tint); }
dl.summary { display: grid; gap: 2px; margin: 0; }
.summary dd { margin: 0 0 var(--space-1); overflow-wrap: anywhere; }
.raw-toggle { display: inline-flex; align-items: center; min-height: var(--tap-target); padding: 0; border: 0; background: transparent; color: var(--tint-label); }
pre { margin: 0; font-size: 0.8125rem; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface); padding: var(--space-2); border-radius: var(--radius-control); }
.warnings { display: flex; flex-direction: column; gap: var(--space-2); margin: 0; padding: 0; list-style: none; }
.notice { display: flex; align-items: flex-start; gap: var(--space-2); margin: 0; padding: var(--space-3); border-radius: var(--radius-control); background: color-mix(in srgb, var(--warning) 18%, var(--surface)); }
.notice.is-error { background: color-mix(in srgb, var(--danger) 14%, var(--surface)); }
.notice-icon { flex: none; margin-top: 1px; }
/* Cancel leads and Approve trails; when they no longer fit side by side, Approve wraps onto the top line. */
.actions { display: flex; flex-direction: row-reverse; flex-wrap: wrap; gap: var(--space-2); }
.actions > * { flex: 1 1 8rem; min-height: 48px; }
.review-head .overview { font-weight: 600; }
.group { display: flex; flex-direction: column; gap: var(--space-2); }
.group-toggle { display: flex; align-items: center; gap: var(--space-2); width: 100%; min-height: 48px; padding: 0 var(--space-3); border: 0; border-radius: var(--radius-control); background: var(--surface-2); color: var(--label); text-align: start; touch-action: manipulation; }
.group-toggle:active { opacity: 0.6; }
.group-name { flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; }
.group-count { flex: none; }
.chevron { flex: none; color: var(--label-3); }
.chevron.is-open { transform: rotate(90deg); }
.reject { align-self: flex-start; }
@media (min-width: 480px) {
  .diff { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (prefers-reduced-motion: reduce) { .group-toggle:active { opacity: 0.7; } }
</style>
