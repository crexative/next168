import { usePlannerStore } from '@/stores/plannerStore'

// "Set up my week" reopens the first-run wizard on an existing workspace: the wizard is shown while
// `settings.onboardingDone` is false, and finishing or leaving it sets the flag again.
export async function reopenOnboarding(planner: ReturnType<typeof usePlannerStore>): Promise<boolean> {
  const result = await planner.commit((draft) => { draft.settings.onboardingDone = false })
  return result.ok
}
