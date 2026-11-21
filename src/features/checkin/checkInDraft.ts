import type { CheckInFormState } from './checkInForm'

// Answers typed into the check-in and not saved yet, kept for this session when the conversation is closed: reopening
// the same day's check-in, over the same stored entry, shows them again instead of dropping them silently. A save, or
// any change to the stored entry, makes the draft stale and it is not used.
interface Draft { key: string; form: CheckInFormState }
let draft: Draft | undefined

export function draftKey(workspaceId: string, date: string, stored: string | undefined): string {
  return JSON.stringify([workspaceId, date, stored ?? null])
}

export function keepDraft(key: string, form: CheckInFormState): void {
  draft = { key, form: { ...form } }
}

export function takeDraft(key: string): CheckInFormState | undefined {
  return draft?.key === key ? { ...draft.form } : undefined
}

export function dropDraft(): void {
  draft = undefined
}
