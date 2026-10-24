import { ref, shallowRef } from 'vue'
import type { ChangeProposal } from '@/core/model'

// What the review sheet shows and what the last decision was. Plain refs so any view can follow them.
// Review provenance belongs to this opening, never to the stored proposal's source.
export type ProposalReview = ChangeProposal & { pastedReply?: boolean }
export const reviewing = shallowRef<ProposalReview | null>(null)
export const lastDecision = ref<{ kind: 'applied' | 'rejected'; id: string; tick: number } | null>(null)
