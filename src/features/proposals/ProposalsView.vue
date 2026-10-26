<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChangeProposal, ProposalHistory } from '@/core/model'
import Button from '@/ui/Button.vue'
import { saveFile } from '@/features/settings/data/preUpgradeCopy'
import { usePlannerStore } from '@/stores/plannerStore'
import { companionWarnings } from '@/repositories/CompanionRepository'
import BackButton from '@/features/settings/BackButton.vue'
import ListGroup from '@/ui/ListGroup.vue'
import ListRow from '@/ui/ListRow.vue'
import { getProposalRepository } from './repository'
import { openProposalReview } from './openProposalReview'
import { pendingCount } from './pending'
import { lastDecision } from './reviewState'

const { t } = useI18n()
const planner = usePlannerStore()
const repository = getProposalRepository()
const proposals = ref<ChangeProposal[]>([])
// Contract 1.0 history and quarantined records: shown, never executed (quarantined ones only as escaped text).
const earlier = ref<ProposalHistory['legacy']>([])
const unreadable = ref<string[]>([])
const message = ref('')
const RAW_PREVIEW = 160
let timer: ReturnType<typeof setInterval> | undefined
async function refresh() {
  if (document.visibilityState === 'hidden') return
  try {
    const history = await repository.history()
    proposals.value = history.proposals.filter((proposal) => proposal.status === 'pending')
    pendingCount.value = proposals.value.length
    earlier.value = history.legacy
    unreadable.value = history.quarantine
  } catch { message.value = t('proposals.loadError') }
}

// The quarantined records exactly as stored, only on this explicit request.
function exportRaw(): void {
  const json = JSON.stringify({ format: 'weeklid-unreadable-proposals', records: unreadable.value }, null, 2)
  saveFile({ fileName: `weeklid-unreadable-proposals-${new Date().toISOString().slice(0, 10)}.json`, json, bytes: new Blob([json]).size })
}

function rawPreview(raw: string): string {
  return raw.length > RAW_PREVIEW ? `${raw.slice(0, RAW_PREVIEW - 1)}…` : raw
}
watch(lastDecision, (decision) => {
  if (!decision) return
  message.value = t(decision.kind === 'applied' ? 'proposals.applied' : 'proposals.rejected')
  void refresh()
})
onMounted(() => { void refresh(); timer = setInterval(() => { void refresh() }, 5000) })
onBeforeUnmount(() => clearInterval(timer))
</script>

<template>
  <div class="proposals-view">
    <BackButton current="proposals" fallback="settings" />
    <p class="t-secondary">{{ t('proposals.description') }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="companionWarnings.length" role="status">{{ t('proposals.durabilityWarning') }}</p>
    <ListGroup :header="t('proposals.title')">
      <ListRow v-for="proposal in proposals" :key="proposal.id" :title="proposal.summary || t('proposals.untitled')" :subtitle="t('proposals.from', { source: proposal.clientName || t(`proposals.sources.${proposal.source}`) })" interactive @click="openProposalReview(proposal)" />
      <ListRow v-if="proposals.length === 0" :title="t('proposals.empty')" />
    </ListGroup>
    <ListGroup v-if="earlier.length" :header="t('proposals.history.earlier')" :footer="t('proposals.history.earlierFooter')" data-testid="earlier-proposals">
      <ListRow v-for="proposal in earlier" :key="proposal.id" :title="proposal.summary || t('proposals.untitled')" :subtitle="t(`proposals.history.statuses.${proposal.status}`)" />
    </ListGroup>
    <ListGroup v-if="unreadable.length" :header="t('proposals.history.unreadable')" :footer="t('proposals.history.unreadableFooter')" data-testid="unreadable-proposals">
      <ListRow v-for="(raw, index) in unreadable" :key="index" :title="t('proposals.history.unreadable')" :subtitle="rawPreview(raw)" />
    </ListGroup>
    <Button v-if="unreadable.length" variant="tinted" data-testid="export-unreadable" @click="exportRaw">{{ t('proposals.history.exportRaw') }}</Button>
    <ListGroup v-if="planner.document?.blocks.length" :header="t('proposals.currentBlocks')" data-testid="applied-blocks">
      <ListRow v-for="block in planner.document.blocks" :key="block.id" :title="block.title" />
    </ListGroup>
  </div>
</template>

<style scoped>
.proposals-view { padding: var(--space-4) var(--page-gutter); }
</style>
