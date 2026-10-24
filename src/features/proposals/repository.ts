import type { ProposalRepository } from '@/core/model'
import { LocalStorageProposalRepository } from '@/repositories/LocalStorageProposalRepository'
import { webLockRunner } from '@/repositories/storageCommit'
import { CompanionProposalRepository, companionMode } from '@/repositories/CompanionRepository'

let repository: ProposalRepository | undefined
export function getProposalRepository(): ProposalRepository {
  return repository ??= companionMode ? new CompanionProposalRepository() : new LocalStorageProposalRepository({
    storage: window.localStorage, runExclusive: webLockRunner(navigator.locks), now: () => new Date(), newId: () => crypto.randomUUID(),
  })
}
