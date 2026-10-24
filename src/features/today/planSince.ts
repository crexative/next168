import type { PlannerDocument } from '@/core/model'
import { zonedInstant } from '@/core/time'

// Today asks "how did it go?" only for blocks that started after the plan existed: a plan made at 14:00
// has nothing to report about a 09:00 block. The document has no creation date, so the first moment Today
// saw blocks is kept on this device, and older evidence of use (an actual, a check-in, a task) lowers it.
const KEY_PREFIX = 'next168-plan-since:'

export function earliestEvidence(document: PlannerDocument): number | undefined {
  const instants = [
    ...document.actuals.map((actual) => Date.parse(actual.plannedStartAt)),
    ...document.checkIns.map((checkIn) => zonedInstant(checkIn.date, 0, document.settings.timeZone).getTime()),
    ...document.tasks.map((task) => Date.parse(task.createdAt)),
  ].filter(Number.isFinite)
  return instants.length ? Math.min(...instants) : undefined
}

export function readPlanSince(workspaceId: string): number | undefined {
  try {
    const value = Number(window.localStorage.getItem(KEY_PREFIX + workspaceId))
    return Number.isFinite(value) && value > 0 ? value : undefined
  } catch {
    return undefined
  }
}

export function stampPlanSince(workspaceId: string, now: Date): number {
  const stored = readPlanSince(workspaceId)
  if (stored !== undefined) return stored
  try {
    window.localStorage.setItem(KEY_PREFIX + workspaceId, String(now.getTime()))
  } catch {
    // Without storage the stamp lives only in memory for this session.
  }
  return now.getTime()
}

export function planSince(document: PlannerDocument, stamped: number | undefined): number | undefined {
  const candidates = [stamped, earliestEvidence(document)].filter((value): value is number => value !== undefined)
  return candidates.length ? Math.min(...candidates) : undefined
}

// Until the plan has been seen once there is nothing to compare with, so nothing is asked yet.
export function isAskable(startIso: string, since: number | undefined): boolean {
  return since !== undefined && Date.parse(startIso) >= since
}
