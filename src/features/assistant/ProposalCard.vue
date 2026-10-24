<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { previewProposal, type ProposalPreview } from '@/core/proposals'
import type { ChangeProposal, ProposalInput } from '@/core/model'
import { createBrowserRepositories } from '@/repositories/browserRepositories'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import { sharedProposalReview } from './proposalReview'

const props = defineProps<{ input: ProposalInput }>()

const { t } = useI18n()
const planner = usePlannerStore()
const proposals = createBrowserRepositories().proposals

const stored = ref<ChangeProposal | null>(null)
const preview = ref<ProposalPreview | null>(null)
const outcome = ref<'applied' | 'rejected' | 'failed' | null>(null)

const lines = computed(() => (preview.value?.changes ?? []).map((change) => {
  const subject = (change.after ?? change.before) as { title?: string; name?: string; id?: string } | null
  return t(`assistant.review.${change.op}`, { subject: subject?.title ?? subject?.name ?? subject?.id ?? '' })
}))

async function review(): Promise<void> {
  const document = planner.document
  if (!document) return
  try {
    stored.value = await proposals.create(props.input, 'assistant')
    const openShared = sharedProposalReview()
    if (openShared) {
      openShared(stored.value)
      return
    }
    preview.value = await previewProposal(document, stored.value)
  } catch {
    outcome.value = 'failed'
  }
}

async function apply(): Promise<void> {
  const proposal = stored.value
  if (!proposal) return
  try {
    const decision = await proposals.approve(proposal.id, proposal.contentHash, proposal.baseRevision)
    outcome.value = decision.kind === 'applied' ? 'applied' : 'failed'
    await planner.load()
  } catch {
    outcome.value = 'failed'
  }
}

async function discard(): Promise<void> {
  if (stored.value) await proposals.reject(stored.value.id)
  outcome.value = 'rejected'
}
</script>

<template>
  <div class="proposal" data-testid="proposal-card">
    <p v-if="outcome" class="t-subhead" role="status">{{ t(`assistant.proposal.${outcome}`) }}</p>
    <template v-else-if="preview">
      <p v-if="!preview.valid" class="t-subhead" role="alert">{{ t('assistant.proposal.failed') }}</p>
      <template v-else>
        <ul class="changes t-subhead">
          <li v-for="line in lines" :key="line">{{ line }}</li>
        </ul>
        <p v-if="preview.warnings.length" class="t-footnote t-secondary">{{ t('assistant.proposal.warnings', { count: preview.warnings.length }) }}</p>
        <div class="actions">
          <Button @click="apply">{{ t('assistant.proposal.apply') }}</Button>
          <Button variant="plain" @click="discard">{{ t('assistant.proposal.discard') }}</Button>
        </div>
      </template>
    </template>
    <Button v-else variant="tinted" @click="review">{{ t('assistant.proposal.review') }}</Button>
  </div>
</template>

<style scoped>
.proposal { margin-top: var(--space-3); }
.changes { margin: 0 0 var(--space-3); padding-inline-start: var(--space-5); }
.actions { display: flex; gap: var(--space-2); }
</style>
