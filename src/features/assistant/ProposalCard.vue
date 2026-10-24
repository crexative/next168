<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { previewProposal, type ProposalPreview } from '@/core/proposals'
import type { ChangeProposal, ProposalInput } from '@/core/model'
import { createBrowserRepositories } from '@/repositories/browserRepositories'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import { buildProposalDiff } from './proposalDiff'
import { sharedProposalReview } from './proposalReview'

const props = defineProps<{ input: ProposalInput }>()

const { t, locale } = useI18n()
const planner = usePlannerStore()
const proposals = createBrowserRepositories().proposals

const stored = ref<ChangeProposal | null>(null)
const preview = ref<ProposalPreview | null>(null)
const outcome = ref<'applied' | 'rejected' | 'failed' | null>(null)

const diff = computed(() => {
  const document = planner.document
  if (!preview.value || !document) return null
  return buildProposalDiff(preview.value, { document, locale: locale.value, timeZone: document.settings.timeZone, translate: (key, params) => t(key, params ?? {}) })
})

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
      <template v-else-if="diff">
        <ul class="changes t-subhead">
          <li v-for="(entry, index) in diff.entries" :key="index" data-testid="proposal-change">
            <strong>{{ t(`assistant.review.${entry.op}`, { subject: entry.subject }) }}</strong>
            <ul class="fields t-footnote">
              <li v-for="field in entry.fields" :key="field.key">
                {{ field.label }}:
                <template v-if="field.before && field.after"><del>{{ field.before }}</del> → <ins>{{ field.after }}</ins></template>
                <template v-else-if="field.after"><ins>{{ field.after }}</ins></template>
                <template v-else><del>{{ field.before }}</del></template>
              </li>
            </ul>
          </li>
        </ul>
        <template v-if="diff.warnings.length">
          <p class="t-footnote t-secondary">{{ t('assistant.proposal.warnings', { count: diff.warnings.length }) }}</p>
          <ul class="fields t-footnote" role="alert"><li v-for="warning in diff.warnings" :key="warning">{{ warning }}</li></ul>
        </template>
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
.fields { margin: 0; padding-inline-start: var(--space-5); }
.actions { display: flex; gap: var(--space-2); }
</style>
