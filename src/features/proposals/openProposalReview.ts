import { createApp } from 'vue'
import { getActivePinia } from 'pinia'
import type { ChangeProposal } from '@/core/model'
import { i18n } from '@/i18n'
import ProposalReviewSheet from './ProposalReviewSheet.vue'
import { reviewing } from './reviewState'

let mounted = false

// Opens the review sheet for a stored proposal from any view. The sheet is mounted on first use,
// when the Pinia instance already exists, and stays for the page's lifetime.
export function openProposalReview(proposal: ChangeProposal): void {
  if (!mounted) {
    mounted = true
    const host = document.createElement('div')
    host.dataset.next168ProposalReview = ''
    document.body.append(host)
    const app = createApp(ProposalReviewSheet).use(i18n)
    const pinia = getActivePinia()
    if (pinia) app.use(pinia)
    app.mount(host)
  }
  // A copy, so opening the proposal that was just closed still counts as a change.
  reviewing.value = { ...proposal }
}
