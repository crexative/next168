<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChangeProposal, ProposalInput } from '@/core/model'
import { openProposalReview } from '@/features/proposals'
import { getProposalRepository } from '@/features/proposals/repository'
import { lastDecision } from '@/features/proposals/reviewState'
import Button from '@/ui/Button.vue'

const props = defineProps<{ input: ProposalInput }>()

const { t } = useI18n()
// The active mode's repository: in companion mode the proposal goes to the companion, never to the browser store.
const proposals = getProposalRepository()

const stored = ref<ChangeProposal | null>(null)
const failed = ref(false)

watch(lastDecision, (decision) => {
  if (stored.value && decision?.id === stored.value.id) stored.value.status = decision.kind
}, { flush: 'sync' })

// The review sheet belongs to the proposals slice; the card only stores the proposal and follows the outcome.
const outcome = computed(() => {
  if (failed.value) return 'failed'
  const status = stored.value?.status
  return status === 'applied' || status === 'rejected' ? status : null
})

async function review(): Promise<void> {
  try {
    stored.value ??= await proposals.create(props.input, 'assistant')
    openProposalReview(stored.value)
  } catch {
    failed.value = true
  }
}
</script>

<template>
  <div class="proposal" data-testid="proposal-card">
    <p v-if="outcome" class="t-subhead" role="status">{{ t(`assistant.proposal.${outcome}`) }}</p>
    <Button v-else variant="tinted" @click="review">{{ t('assistant.proposal.review') }}</Button>
  </div>
</template>

<style scoped>
.proposal { margin-top: var(--space-3); }
</style>
