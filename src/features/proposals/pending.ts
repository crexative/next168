import { ref } from 'vue'
import { getProposalRepository } from './repository'

export const pendingCount = ref(0)
export async function refreshPending(): Promise<void> {
  pendingCount.value = (await getProposalRepository().list('pending')).length
}
