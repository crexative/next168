import { describe, expect, it } from 'vitest'
import type { ProposalPreview } from '@/core/proposals'
import { buildProposalDiff } from './proposalDiff'
import { contextFor, plannerWithBlocks } from './testSupport'

const context = contextFor(plannerWithBlocks())
const env = { document: context.document, locale: 'en', timeZone: 'UTC', translate: context.translate }
const preview = (changes: ProposalPreview['changes'], warnings: string[] = []): ProposalPreview => ({ valid: true, changes, warnings })

describe('proposal diff', () => {
  it('lists every changed block field as before → after, with local times and day names', () => {
    const before = { id: 'work-fri', categoryId: 'work', title: 'Review', days: [5], start: 900, end: 960 }
    const after = { ...before, days: [4, 5], start: 570, end: 1005, categoryId: 'study' }
    const [entry] = buildProposalDiff(preview([{ op: 'update_block', before, after }]), env).entries
    expect(entry!.fields).toEqual([
      { key: 'categoryId', label: 'Category', before: 'Work', after: 'Study' },
      { key: 'days', label: 'Days', before: 'Fri', after: 'Thu, Fri' },
      { key: 'start', label: 'Start', before: '15:00', after: '09:30' },
      { key: 'end', label: 'End', before: '16:00', after: '16:45' },
    ])
  })

  it('does not list unchanged fields and shows every field of an added block', () => {
    const block = { id: 'preview-1', categoryId: 'work', title: 'Gym', days: [4], start: 1080, end: 1140 }
    const [entry] = buildProposalDiff(preview([{ op: 'add_block', before: null, after: block }]), env).entries
    expect(entry!.subject).toBe('Gym')
    expect(entry!.fields.map((field) => [field.key, field.after])).toEqual([['title', 'Gym'], ['categoryId', 'Work'], ['days', 'Thu'], ['start', '18:00'], ['end', '19:00']])
  })

  it('shows task duration, due date and priority, and the goal hours of a category', () => {
    const task = { id: 't', title: 'Report', categoryId: 'work', durationMin: 30, dueDate: '2026-10-30', priority: 1, createdAt: '2026-10-24T00:00:00Z' }
    const taskDiff = buildProposalDiff(preview([{ op: 'update_task', before: task, after: { ...task, durationMin: 90, dueDate: '2026-11-02', priority: 3 } }]), env)
    expect(taskDiff.entries[0]!.fields.map((field) => `${field.key}:${field.before}>${field.after}`)).toEqual(['durationMin:30>90', 'dueDate:2026-10-30>2026-11-02', 'priority:1>3'])
    const goal = buildProposalDiff(preview([{
      op: 'update_category_goal',
      before: { id: 'work', name: 'Work', goal: { type: 'max', hoursPerWeek: 40 } },
      after: { id: 'work', name: 'Work', goal: { type: 'min', hoursPerWeek: 20 } },
    }]), env)
    expect(goal.entries[0]!.fields).toEqual([{ key: 'goal', label: 'Weekly goal', before: 'at most 40 h', after: 'at least 20 h' }])
  })

  it('formats event times in the planner time zone and lists attendees', () => {
    const event = { id: 'e', title: 'Sync', start: '2026-10-26T09:00:00Z', end: '2026-10-26T10:00:00Z', allDay: false, attendees: ['a@example.com'] }
    const [entry] = buildProposalDiff(preview([{ op: 'add_event', before: null, after: event }]), { ...env, timeZone: 'Asia/Tokyo' }).entries
    const byKey = Object.fromEntries(entry!.fields.map((field) => [field.key, field.after]))
    expect(byKey.start).toContain('6:00')
    expect(byKey.end).toContain('7:00')
    expect(byKey.attendees).toBe('a@example.com')
    expect(byKey.allDay).toBe('no')
  })

  it('shows the removed block and translates validation warnings', () => {
    const block = { id: 'work-fri', categoryId: 'work', title: 'Review', days: [5], start: 900, end: 960 }
    const diff = buildProposalDiff(preview([{ op: 'delete_block', before: block, after: null }], ['block.overlap', 'goal.over:work']), env)
    expect(diff.entries[0]!.fields.every((field) => field.before !== '' && field.after === '')).toBe(true)
    expect(diff.warnings).toEqual(['Two blocks overlap after these changes.', 'Work goes over its weekly limit.'])
  })
})
