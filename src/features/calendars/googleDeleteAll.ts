import { calendarMode } from './icsFetcher'

// Delete all data in a server build also asks the Weeklid server to forget this device's Google permission, before the
// wipe (design S1b 2.4). The device's other copies of Weeklid keep theirs. The server client loads only in a server build.
export type GoogleDeleteResult = 'none' | 'unreachable' | 'mayRemain'
export const DELETE_ALL_DEADLINE_MS = 5_000

export async function forgetGoogleBeforeDeleteAll(): Promise<GoogleDeleteResult> {
  const load = import.meta.env.VITE_GOOGLE_SERVER === '1' ? () => import('./google/serverConnection') : undefined
  if (!load || calendarMode() === 'companion') return 'none'
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'unreachable'
  const { browserServerConnection } = await load()
  const outcome = await browserServerConnection().forgetThisDevice(false, { deadlineMs: DELETE_ALL_DEADLINE_MS })
  if (outcome === 'forgotten' || outcome === 'cleared') return 'none'
  return outcome === 'mayRemain' ? 'mayRemain' : 'unreachable'
}
