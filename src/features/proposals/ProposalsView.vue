<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChangeProposal } from '@/core/model'
import { usePlannerStore } from '@/stores/plannerStore'
import { companionWarnings } from '@/repositories/CompanionRepository'
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
const message = ref('')
let timer: ReturnType<typeof setInterval> | undefined
async function refresh() {
  if (document.visibilityState === 'hidden') return
  try { proposals.value = await repository.list('pending'); pendingCount.value = proposals.value.length }
  catch { message.value = t('proposals.loadError') }
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
    <p class="t-secondary">{{ t('proposals.description') }}</p>
    <p v-if="message" role="status">{{ message }}</p>
    <p v-if="companionWarnings.length" role="status">{{ t('proposals.durabilityWarning') }}</p>
    <ListGroup :header="t('proposals.title')">
      <ListRow v-for="proposal in proposals" :key="proposal.id" :title="proposal.summary || t('proposals.untitled')" :subtitle="t('proposals.from', { source: proposal.clientName || proposal.source })" interactive @click="openProposalReview(proposal)" />
      <ListRow v-if="proposals.length === 0" :title="t('proposals.empty')" />
    </ListGroup>
    <ListGroup v-if="planner.document?.blocks.length" :header="t('proposals.currentBlocks')" data-testid="applied-blocks">
      <ListRow v-for="block in planner.document.blocks" :key="block.id" :title="block.title" />
    </ListGroup>
  </div>
</template>

<style scoped>
.proposals-view { padding: var(--space-4); }
</style>
