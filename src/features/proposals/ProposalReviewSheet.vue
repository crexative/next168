<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { previewProposal, type ProposalPreview } from '@/core/proposals'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Sheet from '@/ui/Sheet.vue'
import { refreshPending } from './pending'
import { getProposalRepository } from './repository'
import { lastDecision, reviewing } from './reviewState'

const { t } = useI18n()
const planner = usePlannerStore()
const repository = getProposalRepository()
const preview = ref<ProposalPreview>()
const open = ref(false)
const busy = ref(false)
const message = ref('')

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
  } catch { message.value = t('proposals.decisionError') }
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
            <div><h4 class="t-footnote">{{ t('proposals.before') }}</h4><pre>{{ change.before === null ? '—' : JSON.stringify(change.before, null, 2) }}</pre></div>
            <div><h4 class="t-footnote">{{ t('proposals.after') }}</h4><pre>{{ change.after === null ? '—' : JSON.stringify(change.after, null, 2) }}</pre></div>
          </div>
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
pre { font-size: 0.8125rem; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-2); padding: var(--space-2); border-radius: var(--radius-control); }
.actions { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-block-start: var(--space-4); }
.warnings { padding: var(--space-4); color: var(--warning-label, var(--label)); background: var(--surface-2); border-radius: var(--radius-control); }
</style>
