// The part of Google Identity Services' token model Weeklid uses (developers.google.com/identity/oauth2/web/reference/js-reference).
export const EVENTS_READONLY = 'https://www.googleapis.com/auth/calendar.events.readonly'

export interface GisTokenResponse {
  access_token?: string
  expires_in?: number | string
  scope?: string
  token_type?: string
  error?: string
}

export interface GisErrorResponse { type?: string }

export interface GisTokenClientConfig {
  client_id: string
  scope: string
  include_granted_scopes: boolean
  prompt: string
  callback: (response: GisTokenResponse) => void
  error_callback: (error: GisErrorResponse) => void
}

export interface GisTokenClient { requestAccessToken(): void }

export interface GisOAuth2 {
  initTokenClient(config: GisTokenClientConfig): GisTokenClient
  hasGrantedAllScopes(response: GisTokenResponse, first: string, ...rest: string[]): boolean
  revoke(token: string, done?: (result: { successful?: boolean }) => void): void
}
