<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { ChangeProposal, ProposalInput } from '@/core/model'
import { openProposalReview } from '@/features/proposals'
import { lastDecision } from '@/features/proposals/reviewState'
import { createBrowserRepositories } from '@/repositories/browserRepositories'
import Button from '@/ui/Button.vue'

const props = defineProps<{ input: ProposalInput }>()

const { t } = useI18n()
const proposals = createBrowserRepositories().proposals

const stored = ref<ChangeProposal | null>(null)
const failed = ref(false)

// The review sheet belongs to the proposals slice; the card only stores the proposal and follows the outcome.
const outcome = computed(() => {
  if (failed.value) return 'failed'
  return stored.value && lastDecision.value?.id === stored.value.id ? lastDecision.value.kind : null
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
