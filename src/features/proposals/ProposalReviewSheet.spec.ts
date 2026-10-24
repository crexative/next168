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
  expect(document.body.querySelector<HTMLButtonElement>('[data-testid=review-approve]')!.disabled).toBe(true)
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

it('says in one line when the change leaves a category empty, and where to delete it', async () => {
  mounted = await mountWithPlanner(ProposalReviewSheet)
  const before = previews
  reviewing.value = proposal
  await vi.waitFor(() => expect(previews).toBe(before + 1))
  release({
    valid: true, warnings: [], categories: [], changes: [{ op: 'add_block', before: undefined, after: { title: 'Dormir', categoryId: 'x', days: [1], start: 1350, end: 390 } }],
    emptyCategories: [{ id: 'work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }],
  })
  await vi.waitFor(() => expect(review()!.querySelector('[data-testid=review-empty-category]')).not.toBeNull())
  const notes = review()!.querySelectorAll('[data-testid=review-empty-category]')
  expect(notes).toHaveLength(1)
  expect(notes[0]!.textContent!.trim()).toBe('“Trabajo” will be empty; you can delete it in Settings.')
  // Information, not a warning: no alert role and no warning icon.
  expect(notes[0]!.closest('[role=alert]')).toBeNull()
  expect(notes[0]!.querySelector('svg')).toBeNull()
})

it('says nothing about empty categories for a proposal that cannot be applied', async () => {
  mounted = await mountWithPlanner(ProposalReviewSheet)
  const before = previews
  reviewing.value = proposal
  await vi.waitFor(() => expect(previews).toBe(before + 1))
  release({ valid: false, warnings: [], categories: [], changes: [], emptyCategories: [{ id: 'work', name: 'Trabajo', colorKey: 'blue', goal: { type: 'none', hoursPerWeek: 0 } }], reason: 'proposal.staleRevision' })
  await vi.waitFor(() => expect(review()!.querySelector('[data-testid=review-invalid]')).not.toBeNull())
  expect(review()!.querySelector('[data-testid=review-empty-category]')).toBeNull()
})
