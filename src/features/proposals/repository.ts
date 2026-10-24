import type { ProposalRepository } from '@/core/model'
import { createBrowserRepositories } from '@/repositories/browserRepositories'
import { CompanionProposalRepository, companionMode } from '@/repositories/CompanionRepository'

let repository: ProposalRepository | undefined
export function getProposalRepository(): ProposalRepository {
  return repository ??= companionMode ? new CompanionProposalRepository() : createBrowserRepositories().proposals
}
