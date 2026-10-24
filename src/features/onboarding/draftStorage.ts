import type { DayIndex } from '@/core/model'
import type { BlockPreset, TemplateChoice } from './templates'

// An unfinished wizard survives a reload of the tab (sessionStorage), but only for the exact workspace revision it was
// started on: anything written since, here or in another tab, makes the draft stale and it is dropped, never applied.
const STORAGE_KEY = 'next168-onboarding-draft'
const MAX_NAME_LENGTH = 60
const LAST_MINUTE = 24 * 60 - 1

export interface WizardDraft {
  identity: string
  step: number
  taskTitle: string
  choices: { templateId: string; selected: boolean; name: string; routine: BlockPreset[] }[]
}

type DraftStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function browserStorage(): DraftStorage | undefined {
  try {
    return typeof sessionStorage === 'undefined' ? undefined : sessionStorage
  } catch {
    return undefined
  }
}

export function draftIdentity(document: { workspaceId: string; revision: number }): string {
  return `${document.workspaceId}:${document.revision}`
}

const isMinute = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= LAST_MINUTE
const isDay = (value: unknown): value is DayIndex => Number.isInteger(value) && (value as number) >= 0 && (value as number) <= 6

function validBlock(value: unknown): value is BlockPreset {
  const block = value as BlockPreset | null
  return !!block && isMinute(block.start) && isMinute(block.end) && block.start !== block.end
    && Array.isArray(block.days) && block.days.length > 0 && block.days.every(isDay) && new Set(block.days).size === block.days.length
}

function validDraft(value: unknown, identity: string, lastStep: number): value is WizardDraft {
  const draft = value as WizardDraft | null
  return !!draft && draft.identity === identity
    && Number.isInteger(draft.step) && draft.step >= 0 && draft.step <= lastStep
    && typeof draft.taskTitle === 'string'
    && Array.isArray(draft.choices) && draft.choices.every((choice) => !!choice && typeof choice.templateId === 'string' && typeof choice.selected === 'boolean'
      && typeof choice.name === 'string' && choice.name.length <= MAX_NAME_LENGTH && Array.isArray(choice.routine) && choice.routine.every(validBlock))
}

export function saveDraft(draft: WizardDraft, storage: DraftStorage | undefined = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(draft))
  } catch {
    // Without storage the wizard still works; a reload simply starts over.
  }
}

export function clearDraft(storage: DraftStorage | undefined = browserStorage()): void {
  try {
    storage?.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear.
  }
}

// The saved draft when it belongs to `identity` and is well formed; a stale or damaged one is removed.
export function loadDraft(identity: string, lastStep: number, storage: DraftStorage | undefined = browserStorage()): WizardDraft | null {
  let parsed: unknown
  try {
    const raw = storage?.getItem(STORAGE_KEY)
    if (!raw) return null
    parsed = JSON.parse(raw)
  } catch {
    clearDraft(storage)
    return null
  }
  if (validDraft(parsed, identity, lastStep)) return parsed
  clearDraft(storage)
  return null
}

// Carries the saved picks onto freshly built choices. Only what the person changed comes back: ticks, and for a routine
// the wizard creates, its name and times. A template the saved draft does not know keeps its defaults.
export function applyDraft(choices: TemplateChoice[], draft: WizardDraft): void {
  for (const saved of draft.choices) {
    const choice = choices.find((candidate) => candidate.templateId === saved.templateId)
    if (!choice) continue
    choice.selected = saved.selected
    if (choice.sketch && saved.routine.length > 0 && saved.name.trim() !== '') {
      choice.name = saved.name
      choice.routine = saved.routine.map((block) => ({ start: block.start, end: block.end, days: [...block.days] }))
    }
  }
}

export function draftOf(identity: string, step: number, taskTitle: string, choices: readonly TemplateChoice[]): WizardDraft {
  return {
    identity, step, taskTitle,
    choices: choices.map((choice) => ({
      templateId: choice.templateId, selected: choice.selected, name: choice.name,
      routine: choice.routine.map((block) => ({ start: block.start, end: block.end, days: [...block.days] })),
    })),
  }
}
