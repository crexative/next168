// The accounts build flag (design docs/design/accounts-and-sync.md, slice S1): VITE_ACCOUNTS is unset, '' (= unset) or '1'.
// Anything else fails the build. A build without it carries no account code and makes no request to /api/auth or /api/sync.
export function assertAccountsFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false
  if (raw === '1') return true
  throw new Error('VITE_ACCOUNTS must be unset or 1')
}
