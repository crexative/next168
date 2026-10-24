const STEP_MS = 5 * 60_000

// Tasks are fitted into free time from this instant on. Rounded up to the next five minutes so a re-fitted task
// starts at 12:35, not at the minute the plan happened to be recalculated (12:31). Exactly on a step stays put.
export function placementClock(now: Date): Date {
  return new Date(Math.ceil(now.getTime() / STEP_MS) * STEP_MS)
}
