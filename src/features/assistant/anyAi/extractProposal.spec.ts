import { describe, expect, it } from 'vitest'
import { extractProposal, matchesPlan, MAX_REPLY_BYTES } from './extractProposal'
import { realisticWeek } from './fixtures'

const proposal = (summary = 'Move the gym to Thursday', overrides: Record<string, unknown> = {}) => ({
  contractVersion: '1.0', workspaceId: 'ws-realistic', baseRevision: 7, summary,
  ops: [{ op: 'update_block', id: 'b-gym', patch: { days: [4] } }], ...overrides,
})
const json = (value: unknown) => JSON.stringify(value, null, 2)
const summaryOf = (result: ReturnType<typeof extractProposal>) => (result.ok ? result.input.summary : result.reason)

describe('extractProposal', () => {
  it('reads a fenced next168 block in the middle of a chatty reply', () => {
    const reply = `Sure! Here is a better week.\n\n\`\`\`next168\n${json(proposal())}\n\`\`\`\n\nLet me know if you want anything else.`
    expect(summaryOf(extractProposal(reply))).toBe('Move the gym to Thursday')
  })

  it('reads a ```json block and a block with no label', () => {
    expect(summaryOf(extractProposal(`Here:\n\`\`\`json\n${json(proposal('from json'))}\n\`\`\``))).toBe('from json')
    expect(summaryOf(extractProposal(`Here:\n\`\`\`\n${json(proposal('no label'))}\n\`\`\``))).toBe('no label')
  })

  it('reads a bare object, with prose and braces around it', () => {
    const reply = `I changed {the gym day}. ${JSON.stringify(proposal('bare'))} Hope that helps {really}.`
    expect(summaryOf(extractProposal(reply))).toBe('bare')
  })

  it('reads the object when copying from the chat lost the fences and left the label as a line', () => {
    expect(summaryOf(extractProposal(`Here you go\nnext168\n${json(proposal('label line'))}\nAnything else?`))).toBe('label line')
  })

  it('accepts Windows line endings, an unclosed final fence and a longer fence', () => {
    expect(summaryOf(extractProposal(`x\r\n\`\`\`next168\r\n${json(proposal('crlf')).replace(/\n/g, '\r\n')}\r\n\`\`\`\r\n`))).toBe('crlf')
    expect(summaryOf(extractProposal(`\`\`\`next168\n${json(proposal('unclosed'))}`))).toBe('unclosed')
    expect(summaryOf(extractProposal(`\`\`\`\`next168\n${json(proposal('four'))}\n\`\`\`\``))).toBe('four')
  })

  it('keeps a title that legitimately contains braces, fences text and curly quotes', () => {
    const odd = proposal('odd', { ops: [{ op: 'add_block', block: { categoryId: 'c-work', title: 'Plan {A} “B” ``` C', days: [1], start: 540, end: 600 } }] })
    const result = extractProposal(`\`\`\`next168\n${JSON.stringify(odd)}\n\`\`\``)
    expect(result.ok && result.input.ops[0]).toMatchObject({ block: { title: 'Plan {A} “B” ``` C' } })
  })

  it('repairs curly quotes around keys only when the text is not JSON as written', () => {
    const curly = JSON.stringify(proposal('curly')).replace(/"/g, '”')
    expect(summaryOf(extractProposal(`\`\`\`next168\n${curly}\n\`\`\``))).toBe('curly')
  })

  describe('two blocks', () => {
    it('takes the first valid one, even when a next168 block comes after a json block', () => {
      const reply = `\`\`\`json\n${json(proposal('json first'))}\n\`\`\`\n\`\`\`next168\n${json(proposal('labelled second'))}\n\`\`\``
      expect(summaryOf(extractProposal(reply))).toBe('labelled second')
    })

    it('skips an invalid or damaged first block and takes the next valid one', () => {
      const reply = `\`\`\`next168\n{"ops": [\n\`\`\`\n\`\`\`next168\n${json({ ...proposal(), ops: [] })}\n\`\`\`\n\`\`\`next168\n${json(proposal('third'))}\n\`\`\``
      expect(summaryOf(extractProposal(reply))).toBe('third')
    })

    it('says the changes are invalid when no block is valid, and damaged when none can be read', () => {
      const bad = json({ ...proposal(), ops: [] })
      expect(extractProposal(`\`\`\`next168\n${bad}\n\`\`\`\n\`\`\`next168\n${bad}\n\`\`\``)).toEqual({ ok: false, reason: 'invalid' })
      expect(extractProposal('```next168\n{"ops": [\n```\n```next168\n{"x":\n```')).toEqual({ ok: false, reason: 'malformed' })
    })
  })

  describe('failures', () => {
    it('empty and whitespace-only replies', () => {
      expect(extractProposal('')).toEqual({ ok: false, reason: 'empty' })
      expect(extractProposal(' \n\t ')).toEqual({ ok: false, reason: 'empty' })
    })

    it('plain prose, prose with unrelated code and unrelated JSON are "no proposal"', () => {
      expect(extractProposal('Sure, move the gym to Thursday and you are done.')).toEqual({ ok: false, reason: 'none' })
      expect(extractProposal('Try:\n```python\nprint({"a": 1})\n```')).toEqual({ ok: false, reason: 'none' })
      expect(extractProposal('{"hello": "world"} and {not json at all}')).toEqual({ ok: false, reason: 'none' })
    })

    it('cut-off JSON is damaged, also without fences', () => {
      expect(extractProposal(`\`\`\`next168\n${json(proposal()).slice(0, 60)}`)).toEqual({ ok: false, reason: 'malformed' })
      expect(extractProposal(`Here: {"contractVersion":"1.0","ops":[{"op":"delete_block"`)).toEqual({ ok: false, reason: 'malformed' })
    })

    it('schema violations are invalid: wrong version, unknown operation, no changes, out of range', () => {
      for (const bad of [
        proposal('x', { contractVersion: '2.0' }),
        proposal('x', { ops: [{ op: 'format_disk' }] }),
        proposal('x', { ops: [] }),
        proposal('x', { ops: [{ op: 'add_block', block: { categoryId: 'c-work', title: 'T', days: [9], start: 0, end: 60 } }] }),
        proposal('x', { ops: [{ op: 'add_category', ref: 'new-x', category: { name: '   ' } }] }),
        [proposal()],
      ]) expect(extractProposal(`\`\`\`next168\n${JSON.stringify(bad)}\n\`\`\``)).toEqual({ ok: false, reason: 'invalid' })
    })

    it('reads up to 200 changes, and names how many a longer proposal had', () => {
      const ops = (length: number) => Array.from({ length }, () => ({ op: 'delete_block', id: 'b-gym' }))
      const fenced = (value: unknown) => `\`\`\`next168\n${JSON.stringify(value)}\n\`\`\``
      expect(extractProposal(fenced(proposal('x', { ops: ops(200) })))).toMatchObject({ ok: true })
      expect(extractProposal(fenced(proposal('x', { ops: ops(201) })))).toEqual({ ok: false, reason: 'tooManyOps', count: 201 })
    })

    it('reads a proposal that creates a category and uses its ref, and an old proposal without one', () => {
      const created = proposal('x', { ops: [
        { op: 'add_category', ref: 'new-sleep', category: { name: 'Sleep', goal: { type: 'min', hoursPerWeek: 56 } } },
        { op: 'add_block', block: { categoryId: 'new-sleep', title: 'Sleep', days: [1], start: 1380, end: 420 } },
      ] })
      expect(extractProposal(`\`\`\`next168\n${JSON.stringify(created)}\n\`\`\``)).toMatchObject({ ok: true, input: { ops: [{ op: 'add_category', ref: 'new-sleep' }, { op: 'add_block' }] } })
      expect(extractProposal(`\`\`\`next168\n${JSON.stringify(proposal('x'))}\n\`\`\``)).toMatchObject({ ok: true })
    })

    it('refuses a reply larger than the limit instead of scanning it', () => {
      expect(extractProposal(`${'x'.repeat(MAX_REPLY_BYTES)}${json(proposal())}`)).toEqual({ ok: false, reason: 'tooLarge' })
    })
  })

  it('calls an object that starts like a proposal but has no changes invalid, not "none"', () => {
    expect(extractProposal('The format is {"contractVersion":"1.0"} followed by ops.')).toEqual({ ok: false, reason: 'invalid' })
  })
})

describe('matchesPlan', () => {
  const document = realisticWeek()
  const input = (overrides: Record<string, unknown>) => {
    const result = extractProposal(`\`\`\`next168\n${JSON.stringify(proposal('p', overrides))}\n\`\`\``)
    if (!result.ok) throw new Error(result.reason)
    return result.input
  }

  it('accepts the same workspace and revision', () => {
    expect(matchesPlan(input({}), document)).toBeNull()
  })

  it('refuses another workspace before looking at the revision', () => {
    expect(matchesPlan(input({ workspaceId: 'other', baseRevision: 1 }), document)).toBe('wrongWorkspace')
  })

  it('refuses an older and a newer revision', () => {
    expect(matchesPlan(input({ baseRevision: 6 }), document)).toBe('stale')
    expect(matchesPlan(input({ baseRevision: 8 }), document)).toBe('stale')
  })
})
