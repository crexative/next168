// The server-mode build flags (design 2.7). Values are unset, '' (= unset) or '1'; anything else fails the build, and so
// does a combination that would ship a server-mode client without the pieces it needs.
export interface GoogleBuildFlags {
  clientId: string | undefined
  server: string | undefined
  installed: string | undefined
}

function flag(name: string, raw: string | undefined): boolean {
  if (raw === undefined || raw === '') return false
  if (raw === '1') return true
  throw new Error(`${name} must be unset or 1`)
}

export function assertGoogleServerFlags(flags: GoogleBuildFlags): void {
  const server = flag('VITE_GOOGLE_SERVER', flags.server)
  const installed = flag('VITE_GOOGLE_SERVER_INSTALLED', flags.installed)
  if (server && !flags.clientId) throw new Error('VITE_GOOGLE_SERVER=1 needs VITE_GOOGLE_CLIENT_ID')
  if (installed && !server) throw new Error('VITE_GOOGLE_SERVER_INSTALLED=1 needs VITE_GOOGLE_SERVER=1')
}
