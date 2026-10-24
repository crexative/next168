// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import type { ChangeProposal } from '@/core/model'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import { reviewing } from './reviewState'
import ProposalReviewSheet from './ProposalReviewSheet.vue'

let release: (value: unknown) => void = () => undefined
let previews = 0
vi.mock('./repository', () => ({ getProposalRepository: () => ({ list: async () => [] }) }))
vi.mock('@/core/proposals', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/core/proposals')>()),
  previewProposal: () => new Promise((resolve) => { previews += 1; release = resolve }),
}))

let mounted: Mounted | undefined
afterEach(() => { mounted?.unmount(); reviewing.value = null; document.body.innerHTML = '' })

const proposal = { id: 'p1', summary: 'Add a focus hour', baseRevision: 1, contentHash: 'h', source: 'import', status: 'pending' } as unknown as ChangeProposal
const review = () => document.body.querySelector<HTMLElement>('[data-testid=proposal-review]')

it('says it is loading instead of flashing "cannot be applied" while the preview is computed', async () => {
  mounted = await mountWithPlanner(ProposalReviewSheet)
  reviewing.value = proposal
  await vi.waitFor(() => expect(review()).not.toBeNull())
  expect(review()!.querySelector('[data-testid=review-loading]')!.textContent).toBe('Loading proposal…')
  expect(review()!.querySelector('[role=alert]')).toBeNull()
  expect([...review()!.querySelectorAll('button')].find((button) => button.textContent === 'Approve')!.disabled).toBe(true)
})

it('shows each change as a card with Before and After sections, and a warning with an icon and text', async () => {
  mounted = await mountWithPlanner(ProposalReviewSheet)
  const before = previews
  reviewing.value = proposal
  await vi.waitFor(() => expect(previews).toBe(before + 1))
  release({ valid: true, warnings: ['overlap:b'], changes: [{ op: 'add_block', before: undefined, after: { title: 'Focus', categoryId: 'x', days: [1], start: 540, end: 600 } }] })
  await vi.waitFor(() => expect(review()!.querySelector('.change')).not.toBeNull())
  await nextTick()
  const card = review()!.querySelector('.change')!
  expect([...card.querySelectorAll('.side')].map((side) => side.getAttribute('aria-label'))).toEqual(['Before', 'After'])
  expect(card.querySelector('ol, li > ol')).toBeNull()
  const warning = review()!.querySelector('.warnings li')!
  expect(warning.querySelector('svg')).not.toBeNull()
  expect(warning.textContent).toContain('overlap')
  expect(review()!.querySelector('[data-testid=review-loading]')).toBeNull()
})
