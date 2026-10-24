import { CalendarImportError, MAX_ICS_BYTES } from '@/core/icsImport'

export interface IcsFetcher { fetch(url: string): Promise<string> }
export type CalendarMode = 'browser' | 'companion'

export function calendarMode(): CalendarMode {
  return (globalThis as { window?: { __NEXT168__?: { mode?: string } } }).window?.__NEXT168__?.mode === 'companion' ? 'companion' : 'browser'
}

export function normalizeCalendarUrl(value: string): string {
  try {
    const url = new URL(value.trim().replace(/^webcal:/i, 'https:'))
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('url')
    return url.toString()
  } catch { throw new CalendarImportError('url') }
}

export function createIcsFetcher(request: typeof fetch = globalThis.fetch.bind(globalThis), mode: CalendarMode = calendarMode()): IcsFetcher {
  return {
    async fetch(value) {
      const url = normalizeCalendarUrl(value)
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), 10000)
      try {
        const response = await request(mode === 'companion' ? `/api/ics?url=${encodeURIComponent(url)}` : url, {
          mode: 'cors', credentials: mode === 'companion' ? 'same-origin' : 'omit', signal: controller.signal,
          referrerPolicy: 'no-referrer',
        })
        if (!response.ok || !response.body) throw new CalendarImportError('fetch')
        if (Number(response.headers.get('content-length')) > MAX_ICS_BYTES) throw new CalendarImportError('size')
        const reader = response.body.getReader(), decoder = new TextDecoder()
        let bytes = 0, text = ''
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > MAX_ICS_BYTES) { await reader.cancel(); throw new CalendarImportError('size') }
            text += decoder.decode(value, { stream: true })
          }
        } finally { reader.releaseLock() }
        return text + decoder.decode()
      } catch (error) {
        if (error instanceof CalendarImportError) throw error
        throw new CalendarImportError('fetch')
      } finally { clearTimeout(timeout) }
    },
  }
}
