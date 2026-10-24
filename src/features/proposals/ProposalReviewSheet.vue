<script setup lang="ts">
import { computed, ref, watch } from 'vue'
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
import { lastDecision, reviewing } from './reviewState'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const repository = getProposalRepository()
const preview = ref<ProposalPreview>()
const open = ref(false)
const busy = ref(false)
const message = ref('')
// The raw change is only put on the page while it is asked for.
const rawOpen = ref(new Set<number>())
function toggleRaw(index: number): void {
  const next = new Set(rawOpen.value)
  if (!next.delete(index)) next.add(index)
  rawOpen.value = next
}
const summaryContext = computed(() => ({
  categories: planner.document?.categories ?? [],
  locale: locale.value,
  timeZone: planner.document?.settings.timeZone ?? 'UTC',
  t: (key: string, params?: Record<string, unknown>) => t(key, params ?? {}),
}))
const summarize = (value: unknown) => summarizeEntity(value, summaryContext.value)

// The sheet is mounted outside the shell, so the storage error screen cannot cover it: it closes instead.
watch(() => planner.status, (status) => { if (status === 'error') open.value = false })

watch(reviewing, async (proposal) => {
  if (!proposal) return
  preview.value = undefined; message.value = ''; rawOpen.value = new Set(); open.value = true
  await planner.load()
  if (planner.document && planner.status === 'ready' && reviewing.value === proposal) preview.value = await previewProposal(planner.document, proposal)
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
        <p class="t-footnote t-secondary">{{ t('proposals.revision', { revision: reviewing.baseRevision }) }}</p>
      </header>
      <p v-if="!preview" class="t-subhead t-secondary" role="status" data-testid="review-loading">{{ t('proposals.loading') }}</p>
      <p v-else-if="!preview.valid" class="notice is-error t-subhead" role="alert">
        <Icon name="triangle-alert" :size="20" class="notice-icon" />
        <span>{{ preview.reason === 'proposal.staleRevision' ? t('proposals.stale') : t('proposals.invalid') }}</span>
      </p>
      <ul v-if="preview?.warnings.length" class="warnings" aria-live="polite">
        <li v-for="warning in preview.warnings" :key="warning" class="notice t-subhead">
          <Icon name="triangle-alert" :size="20" class="notice-icon" />
          <span>{{ t(warning.startsWith('goal.over:') ? 'proposals.overGoal' : 'proposals.overlap') }}</span>
        </li>
      </ul>
      <ul class="changes">
        <li v-for="(change, index) in preview?.changes ?? []" :key="index" class="change">
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
      <p v-if="message" class="t-subhead" role="status">{{ message }}</p>
      <div class="actions">
        <Button :disabled="busy || !preview?.valid" @click="decide(true)">{{ t('proposals.approve') }}</Button>
        <Button variant="plain" destructive :disabled="busy" @click="decide(false)">{{ t('proposals.reject') }}</Button>
      </div>
    </div>
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
.actions { display: flex; flex-direction: column-reverse; gap: var(--space-2); }
.actions > * { width: 100%; }
@media (min-width: 480px) {
  .diff { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .actions { flex-direction: row; justify-content: flex-end; }
  .actions > * { width: auto; }
}
</style>
