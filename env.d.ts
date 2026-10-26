/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_E2E?: string
  // The public address printed on shared images; validated at build time (config/publicUrl.ts).
  readonly VITE_PUBLIC_URL?: string
}
