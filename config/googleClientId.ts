// The Google OAuth web client ID, set only by the build environment (VITE_GOOGLE_CLIENT_ID). The ID is public by
// design; a malformed one would ship a Connect button that can only fail, so vite.config.ts fails the build instead.
export const GOOGLE_CLIENT_ID_PATTERN = /^\d+-[a-z0-9]+\.apps\.googleusercontent\.com$/

export function assertGoogleClientId(raw: string, variable = 'VITE_GOOGLE_CLIENT_ID'): string {
  if (!GOOGLE_CLIENT_ID_PATTERN.test(raw)) throw new Error(`${variable} is not a Google OAuth web client ID (<digits>-<id>.apps.googleusercontent.com)`)
  return raw
}
