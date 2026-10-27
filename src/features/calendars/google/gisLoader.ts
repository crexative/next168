import type { GisOAuth2 } from './gis'

export const GIS_SCRIPT_URL = 'https://accounts.google.com/gsi/client'
export const GIS_LOAD_DEADLINE_MS = 15_000

let loading: Promise<GisOAuth2> | undefined

function loadedApi(): GisOAuth2 | undefined {
  return (globalThis as { google?: { accounts?: { oauth2?: GisOAuth2 } } }).google?.accounts?.oauth2
}

// Injects Google's sign-in script once. It is never loaded at boot: only when the person opens the Connect sheet, so
// Google learns nothing about a visit until the person chooses to connect. A failed load can be tried again.
export function loadGis(host: Document = document): Promise<GisOAuth2> {
  const ready = loadedApi()
  if (ready) return Promise.resolve(ready)
  loading ??= new Promise<GisOAuth2>((resolve, reject) => {
    const script = host.createElement('script')
    const fail = () => {
      clearTimeout(deadline)
      script.remove()
      loading = undefined
      reject(new Error('gisLoad'))
    }
    const deadline = setTimeout(fail, GIS_LOAD_DEADLINE_MS)
    script.src = GIS_SCRIPT_URL
    script.async = true
    script.onerror = fail
    script.onload = () => {
      const api = loadedApi()
      if (!api) { fail(); return }
      clearTimeout(deadline)
      resolve(api)
    }
    host.head.append(script)
  })
  return loading
}
