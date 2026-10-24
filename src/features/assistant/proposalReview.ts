import type { ChangeProposal } from '@/core/model'

type ReviewModule = { openProposalReview?: (proposal: ChangeProposal) => void }

// S4 owns the review sheet. Until its module exists in the build this resolves to undefined and the
// assistant falls back to its own minimal preview.
const reviewModules = import.meta.glob<ReviewModule>('../proposals/index.ts', { eager: true })

export function sharedProposalReview(): ((proposal: ChangeProposal) => void) | undefined {
  return Object.values(reviewModules).find((module) => module.openProposalReview)?.openProposalReview
}
