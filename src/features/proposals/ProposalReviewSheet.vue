<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { previewProposal, type ProposalPreview } from '@/core/proposals'
import { failureReason, isStorageFailure } from '@/repositories/storageCommit'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
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
  preview.value = undefined; message.value = ''; open.value = true
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
    <template v-if="reviewing">
      <p class="t-headline">{{ reviewing.summary }}</p>
      <p class="t-footnote t-secondary">{{ t('proposals.revision', { revision: reviewing.baseRevision }) }}</p>
      <p v-if="!preview?.valid" role="alert">{{ preview?.reason === 'proposal.staleRevision' ? t('proposals.stale') : t('proposals.invalid') }}</p>
      <ul v-if="preview?.warnings.length" class="warnings" aria-live="polite">
        <li v-for="warning in preview.warnings" :key="warning">{{ t(warning.startsWith('goal.over:') ? 'proposals.overGoal' : 'proposals.overlap') }}</li>
      </ul>
      <ol class="changes">
        <li v-for="(change, index) in preview?.changes ?? []" :key="index" class="change">
          <h3 class="t-headline">{{ t(`proposals.operations.${change.op}`) }}</h3>
          <div class="diff">
            <div v-for="side in (['before', 'after'] as const)" :key="side">
              <h4 class="t-footnote">{{ t(`proposals.${side}`) }}</h4>
              <dl v-if="summarize(change[side]).length" class="summary" :data-testid="`change-${side}`">
                <template v-for="row in summarize(change[side])" :key="row.label"><dt class="t-footnote t-secondary">{{ row.label }}</dt><dd>{{ row.value }}</dd></template>
              </dl>
              <p v-else class="t-secondary">{{ t('proposals.nothing') }}</p>
            </div>
          </div>
          <details class="raw">
            <summary class="t-footnote">{{ t('proposals.details') }}</summary>
            <pre>{{ JSON.stringify({ before: change.before, after: change.after }, null, 2) }}</pre>
          </details>
        </li>
      </ol>
      <p v-if="message" role="status">{{ message }}</p>
      <div class="actions">
        <Button :disabled="busy || !preview?.valid" @click="decide(true)">{{ t('proposals.approve') }}</Button>
        <Button variant="plain" destructive :disabled="busy" @click="decide(false)">{{ t('proposals.reject') }}</Button>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.changes { padding-inline-start: var(--space-4); margin-block: var(--space-4); }
.change { padding-block: var(--space-3); border-bottom: 1px solid var(--separator); }
.diff { display: grid; gap: var(--space-2); grid-template-columns: repeat(2, minmax(0, 1fr)); }
dl.summary { display: grid; gap: 2px; margin: 0; }
.summary dd { margin: 0 0 var(--space-1); overflow-wrap: anywhere; }
.raw { margin-block-start: var(--space-2); }
pre { font-size: 0.8125rem; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-2); padding: var(--space-2); border-radius: var(--radius-control); }
.actions { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-block-start: var(--space-4); }
.warnings { padding: var(--space-4); color: var(--warning-label, var(--label)); background: var(--surface-2); border-radius: var(--radius-control); }
</style>
