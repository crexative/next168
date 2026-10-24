import { describe, expect, it } from 'vitest'
import { answerText, validatedProposal } from './modelOutput'
import { AssistantError } from './provider'
import { plannerWithBlocks } from './testSupport'

const document = plannerWithBlocks()
const addBlock = { op: 'add_block', block: { categoryId: 'work', title: 'Gym', days: [4], start: 1080, end: 1140 } }
const reply = (extra: Record<string, unknown> = {}) => JSON.stringify({ summary: 'Add a gym block', ops: [addBlock], ...extra })

async function code(promise: Promise<unknown>): Promise<string | undefined> {
  return promise.then(() => undefined, (error: unknown) => (error instanceof AssistantError ? error.code : 'not-assistant-error'))
}

describe('model output validation', () => {
  it('accepts a schema-valid proposal and binds it to the document', async () => {
    const proposal = await validatedProposal(reply({ workspaceId: 'hallucinated', baseRevision: 99 }), document)
    expect(proposal).toMatchObject({ contractVersion: '1.0', workspaceId: document.workspaceId, baseRevision: document.revision, summary: 'Add a gym block' })
  })

  it.each([
    ['not JSON', 'Sure! Here is your plan'],
    ['a JSON array', '[1]'],
    ['no operations', JSON.stringify({ summary: 'x', ops: [] })],
    ['an unknown operation', JSON.stringify({ summary: 'x', ops: [{ op: 'format_disk' }] })],
    ['a minute out of range', JSON.stringify({ summary: 'x', ops: [{ ...addBlock, block: { ...addBlock.block, start: 5000 } }] })],
    ['a day out of range', JSON.stringify({ summary: 'x', ops: [{ ...addBlock, block: { ...addBlock.block, days: [9] } }] })],
    ['a missing summary', JSON.stringify({ ops: [addBlock] })],
  ])('rejects %s as invalid-output', async (_label, text) => {
    expect(await code(validatedProposal(text, document))).toBe('invalid-output')
  })

  it('rejects an operation that targets something that does not exist', async () => {
    const text = JSON.stringify({ summary: 'x', ops: [{ op: 'delete_block', id: 'no-such-block' }] })
    expect(await code(validatedProposal(text, document))).toBe('invalid-output')
  })

  it('rejects a block for a category that does not exist', async () => {
    const text = JSON.stringify({ summary: 'x', ops: [{ ...addBlock, block: { ...addBlock.block, categoryId: 'ghost' } }] })
    expect(await code(validatedProposal(text, document))).toBe('invalid-output')
  })

  it('extracts the answer and rejects an empty or missing one', () => {
    expect(answerText('{"answer":" 13 h "}')).toBe('13 h')
    expect(() => answerText('{"answer":""}')).toThrow(AssistantError)
    expect(() => answerText('{"text":"x"}')).toThrow(AssistantError)
    expect(() => answerText('nope')).toThrow(AssistantError)
  })
})
