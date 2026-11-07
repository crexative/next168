/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_E2E?: string
  // The public address printed on shared images; validated at build time (config/publicUrl.ts).
  readonly VITE_PUBLIC_URL?: string
  // The public Google OAuth web client ID; without it no Google code ships (config/googleClientId.ts).
  readonly VITE_GOOGLE_CLIENT_ID?: string
  // '1' builds the client that stays connected through the Weeklid Google server (docs/design/google-permanent-connection-s1b.md).
  readonly VITE_GOOGLE_SERVER?: string
  // '1' also admits installed apps to the server source, set only after gate G-1 passed.
  readonly VITE_GOOGLE_SERVER_INSTALLED?: string
  // '1' ships the accounts and sync client (docs/design/accounts-and-sync.md); off by default and for every free build.
  readonly VITE_ACCOUNTS?: string
}
