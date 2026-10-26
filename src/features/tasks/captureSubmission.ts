import { ref } from 'vue'
import {
  addCapturedTasks, bindToPlanner, captureAttempt, reconcileCapture,
  type CaptureAttempt, type CaptureBinding, type CapturedTask, type CaptureReceipt,
} from './personActions'

// The submission state of one capture box (tasks design addendum 6.1 F2):
// - 'saving': the attempt is on its way; the box and its buttons are disabled.
// - 'checking': the outcome is unknown (a lost response); the planner is read again before anything else is sent.
// - 'unverified': that read failed; nothing is sent until «Reintentar» reads again.
// - 'notSaved': the read proved the attempt was not committed; the next tap sends the SAME attempt again.
// - 'changed': the planner changed after the preview was built; the preview is built again and the person taps again.
// - 'invalid': the contract refused a row.
export type SubmissionState = 'idle' | 'saving' | 'checking' | 'unverified' | 'notSaved' | 'changed' | 'invalid'

export function useCaptureSubmission() {
  const state = ref<SubmissionState>('idle')
  // The attempt whose outcome is not known yet, or that was proved not saved: never replaced by a new one meanwhile.
  let pending: CaptureAttempt | undefined

  const busy = () => state.value === 'saving' || state.value === 'checking' || state.value === 'unverified'

  async function settle(attempt: CaptureAttempt): Promise<CaptureReceipt | undefined> {
    state.value = 'checking'
    const read = await reconcileCapture(attempt)
    if (read.kind === 'added') {
      pending = undefined
      state.value = 'idle'
      return read.receipt
    }
    state.value = read.kind === 'unverified' ? 'unverified' : 'notSaved'
    return undefined
  }

  // Sends `rows` on `binding` (a fresh binding for a single line; the preview's for a pasted list). Resolves with the
  // receipt once the tasks are stored.
  async function submit(rows: readonly CapturedTask[], binding: CaptureBinding | null): Promise<CaptureReceipt | undefined> {
    if (busy() || !binding) return undefined
    let attempt: CaptureAttempt
    try {
      attempt = pending ?? captureAttempt(rows)
    } catch {
      state.value = 'invalid'
      return undefined
    }
    pending = attempt
    state.value = 'saving'
    const outcome = await addCapturedTasks(attempt, binding)
    switch (outcome.kind) {
      case 'added':
        pending = undefined
        state.value = 'idle'
        return outcome.receipt
      case 'changed-elsewhere':
        pending = undefined
        state.value = 'changed'
        return undefined
      case 'invalid':
        pending = undefined
        state.value = 'invalid'
        return undefined
      case 'unknown':
        return settle(attempt)
    }
  }

  // «Reintentar» after an unverified outcome: reads the planner again for the same attempt.
  async function check(): Promise<CaptureReceipt | undefined> {
    if (!pending || state.value !== 'unverified') return undefined
    return settle(pending)
  }

  function reset(): void {
    if (busy()) return
    pending = undefined
    state.value = 'idle'
  }

  return { state, submit, check, reset, bind: bindToPlanner }
}
