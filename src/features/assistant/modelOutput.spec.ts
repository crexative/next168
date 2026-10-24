import { describe, expect, it } from 'vitest'
import { answerFromChangeReply, answerText, validatedProposal } from './modelOutput'
import { AssistantError } from './provider'
import { contextFor, plannerWithBlocks } from './testSupport'

const document = plannerWithBlocks()
const addBlock = { op: 'add_block', block: { categoryId: 'work', title: 'Gym', days: [4], start: 1080, end: 1140 } }
const proposalFor = (op: Record<string, unknown>) => ({ contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision, summary: 'Add a gym block', ops: [op] })

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(() => undefined, (error: unknown) => (error instanceof AssistantError ? error.code : 'not-assistant-error'))
}

describe('model output validation', () => {
  it('accepts a schema-valid proposal', async () => {
    expect(await validatedProposal(proposalFor(addBlock), document)).toMatchObject({ workspaceId: document.workspaceId, baseRevision: document.revision })
  })

  it.each([
    ['no operations', { ...proposalFor(addBlock), ops: [] }],
    ['an unknown operation', proposalFor({ op: 'format_disk' })],
    ['a minute out of range', proposalFor({ ...addBlock, block: { ...addBlock.block, start: 5000 } })],
    ['a day out of range', proposalFor({ ...addBlock, block: { ...addBlock.block, days: [9] } })],
    ['a missing summary', { ...proposalFor(addBlock), summary: undefined }],
    ['an operation that targets something that does not exist', proposalFor({ op: 'delete_block', id: 'no-such-block' })],
    ['a block for a category that does not exist', proposalFor({ ...addBlock, block: { ...addBlock.block, categoryId: 'ghost' } })],
    ['another workspace', { ...proposalFor(addBlock), workspaceId: 'someone-else' }],
    ['a stale revision', { ...proposalFor(addBlock), baseRevision: 99 }],
  ])('rejects %s as invalid-output', async (_label, candidate) => {
    expect(await code(validatedProposal(candidate, document))).toBe('invalid-output')
  })

  it('turns an intent reply into a bound proposal, or into a message when the request is incomplete', async () => {
    const proposal = await answerFromChangeReply('{"intent":"add_block","title":"Gym","categoryName":"Work","day":"thursday","start":"18:00","durationHours":1}', 'Add a gym block', contextFor(document))
    expect(proposal.answer).toBe('Add "Gym" on Thursday, 18:00–19:00')
    expect(proposal.proposal?.ops).toEqual([addBlock])
    const unclear = await answerFromChangeReply('{"intent":"add_block","title":"Gym"}', 'Add a gym block', contextFor(document))
    expect(unclear.proposal).toBeUndefined()
    expect(unclear.answer).toContain('I need more detail')
  })

  it.each([['not JSON', 'Sure! Here is your plan'], ['a JSON array', '[1]'], ['a proposal instead of an intent', JSON.stringify(proposalFor(addBlock))]])(
    'rejects a reply that is %s as invalid-output', async (_label, text) => {
      expect(await code(answerFromChangeReply(text, 'Add a gym block', contextFor(document)))).toBe('invalid-output')
    })

  it('extracts the answer and rejects an empty or missing one', () => {
    expect(answerText('{"answer":" 13 h "}')).toBe('13 h')
    expect(() => answerText('{"answer":""}')).toThrow(AssistantError)
    expect(() => answerText('{"text":"x"}')).toThrow(AssistantError)
    expect(() => answerText('nope')).toThrow(AssistantError)
  })
})
