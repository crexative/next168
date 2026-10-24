<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChangeProposal } from '@/core/model'
import { previewProposal, type ProposalPreview } from '@/core/proposals'
import { usePlannerStore } from '@/stores/plannerStore'
import { companionWarnings } from '@/repositories/CompanionRepository'
import Button from '@/ui/Button.vue'
import Sheet from '@/ui/Sheet.vue'
import ListGroup from '@/ui/ListGroup.vue'
import ListRow from '@/ui/ListRow.vue'
import { getProposalRepository } from './repository'
import { pendingCount } from './pending'

const { t } = useI18n()
const planner = usePlannerStore()
const repository = getProposalRepository()
const proposals = ref<ChangeProposal[]>([])
const selected = ref<ChangeProposal>()
const preview = ref<ProposalPreview>()
const open = ref(false)
const busy = ref(false)
const message = ref('')
let timer: ReturnType<typeof setInterval> | undefined
async function refresh() {
  if (document.visibilityState === 'hidden') return
  try { proposals.value = await repository.list('pending'); pendingCount.value = proposals.value.length }
  catch { message.value = t('proposals.loadError') }
}
async function review(proposal: ChangeProposal) {
  selected.value = proposal; preview.value = undefined; message.value = ''; open.value = true
  await planner.load()
  if (planner.document && planner.status === 'ready') preview.value = await previewProposal(planner.document, proposal)
}
async function decide(approve: boolean) {
  if (!selected.value || busy.value) return
  const proposal = selected.value
  busy.value = true; message.value = ''
  try {
    const result = approve ? await repository.approve(proposal.id, proposal.contentHash, proposal.baseRevision) : await repository.reject(proposal.id)
    if (result.kind === 'stale') {
      message.value = t('proposals.stale')
      if (preview.value) preview.value.valid = false
    } else if (result.kind === 'applied' || result.kind === 'rejected') {
      await planner.load(); await refresh(); open.value = false
      message.value = t(result.kind === 'applied' ? 'proposals.applied' : 'proposals.rejected')
    } else message.value = t('proposals.notFound')
  } catch { message.value = t('proposals.decisionError') }
  finally { busy.value = false }
}
onMounted(() => { void refresh(); timer = setInterval(() => { void refresh() }, 5000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="proposals-view">
    <p class="t-secondary">{{ t('proposals.description') }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="companionWarnings.length" role="status">{{ t('proposals.durabilityWarning') }}</p>
    <ListGroup :header="t('proposals.title')">
      <ListRow v-for="proposal in proposals" :key="proposal.id" :title="proposal.summary || t('proposals.untitled')" :subtitle="t('proposals.from', { source: proposal.clientName || proposal.source })" interactive @click="review(proposal)" />
      <ListRow v-if="proposals.length === 0" :title="t('proposals.empty')" />
    </ListGroup>
    <ListGroup v-if="planner.document?.blocks.length" :header="t('proposals.currentBlocks')" data-testid="applied-blocks">
      <ListRow v-for="block in planner.document.blocks" :key="block.id" :title="block.title" />
    </ListGroup>
    <Sheet v-model:open="open" :title="t('proposals.review')">
      <template v-if="selected">
        <p class="t-headline">{{ selected.summary }}</p>
        <p class="t-footnote t-secondary">{{ t('proposals.revision', { revision: selected.baseRevision }) }}</p>
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
  </div>
</template>

<style scoped>
.proposals-view { padding: var(--space-4); }
.changes { padding-inline-start: var(--space-4); margin-block: var(--space-4); }
.change { padding-block: var(--space-3); border-bottom: 1px solid var(--separator); }
.diff { display: grid; gap: var(--space-2); grid-template-columns: repeat(2, minmax(0, 1fr)); }
pre { font-size: 0.8125rem; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--surface-2); padding: var(--space-2); border-radius: var(--radius-control); }
.actions { display: flex; gap: var(--space-2); flex-wrap: wrap; margin-block-start: var(--space-4); }
.warnings { padding: var(--space-4); color: var(--warning-label, var(--label)); background: var(--surface-2); border-radius: var(--radius-control); }
</style>
