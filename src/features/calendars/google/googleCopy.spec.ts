import { describe, expect, it } from 'vitest'
import { SUPPORTED_LOCALES, i18n } from '@/i18n'

// The connection's copy (Slice 1 spec §4 "Copy", acceptance A14). Parity and informal voice across the five locales
// are enforced for every key by src/i18n/messages.spec.ts and src/i18n/informalCopy.spec.ts.
const t = (key: string, locale: string) => i18n.global.t(key, {}, { locale })

describe('Google Calendar copy', () => {
  it('keeps the existing "Add to Google Calendar" link text a plain string beside the new namespace', () => {
    expect(t('calendars.google', 'en')).toBe('Add to Google Calendar')
    for (const locale of SUPPORTED_LOCALES) {
      const calendars = (i18n.global.getLocaleMessage(locale) as Record<string, Record<string, unknown>>).calendars!
      expect(typeof calendars.google, locale).toBe('string')
      expect(typeof calendars.googleConnection, locale).toBe('object')
    }
  })

  it('says in Spanish, before connecting, that Weeklid only reads and that AI gets meetings as busy time', () => {
    const sheet = ['readOnly', 'deviceCopy', 'refreshHint', 'aiBusy', 'testing'].map((key) => t(`calendars.googleConnection.${key}`, 'es')).join(' ')
    expect(sheet).toContain('solo leerá')
    expect(sheet).toContain('Ocupado')
    expect(sheet).toContain('Nunca crea, cambia ni borra eventos')
    expect(t('calendars.googleConnection.busyForAi', 'es')).toBe('Ocupado')
    expect(t('calendars.googleConnection.aiNote', 'es')).toBe('Reuniones de Google: solo como «Ocupado».')
  })

  // The events are kept on this device between visits: the copy must say so, and that Disconnect deletes them.
  it('says in Spanish that a copy stays only on this device and goes on Disconnect, never that it is memory only', () => {
    const sheet = ['readOnly', 'deviceCopy', 'refreshHint'].map((key) => t(`calendars.googleConnection.${key}`, 'es')).join(' ')
    expect(sheet).toContain('se guarda solo en este dispositivo')
    expect(sheet).toContain('nunca pasa por servidores de Weeklid')
    expect(sheet).toContain('se borra al desconectar')
    for (const locale of SUPPORTED_LOCALES) {
      const promises = ['summary', 'deviceCopy', 'refreshHint', 'disconnectBody'].map((key) => t(`calendars.googleConnection.${key}`, locale)).join(' ')
      expect(promises, locale).not.toMatch(/memoria de esta pestaña|this tab's memory|Speicher dieses Tabs|mémoire de cet onglet|memória deste separador/u)
    }
  })

  it.each(SUPPORTED_LOCALES)('has every connection message in %s', (locale) => {
    for (const key of ['revokeConfirmed', 'revokeUnconfirmed', 'popupBlocked', 'accessDenied', 'missingScope', 'busy', 'denied', 'network', 'timeout', 'tooMany', 'format', 'gisLoad']) {
      const text = t(`calendars.googleConnection.messages.${key}`, locale)
      expect(text, key).not.toBe(`calendars.googleConnection.messages.${key}`)
    }
  })

  // Server mode (design S1b section 3): nothing about Google is saved on the device, Disconnect is account-wide, and the
  // way to remove access at Google is always named.
  describe('server mode', () => {
    const SERVER_KEYS = ['summaryServer', 'stayConnected', 'goesToGoogle', 'testingServer', 'eventsOffline', 'disconnectBodyServer', 'disconnectNeedsNetwork', 'deleteAllGoogleOffline', 'googleAccessMayRemain', 'installedNote']
    const SERVER_MESSAGES = ['disconnectFailed', 'revokeUnconfirmedServer', 'reconnectNeeded', 'serverPaused', 'serverUnavailable', 'connectFailed', 'lockUnavailable']
    const serverTexts = (locale: string) => [
      ...SERVER_KEYS.map((key) => t(`calendars.googleConnection.${key}`, locale)),
      ...SERVER_MESSAGES.map((key) => t(`calendars.googleConnection.messages.${key}`, locale)),
    ]

    it('says in Spanish that the events are not saved on this device and where the permission lives', () => {
      expect(t('calendars.googleConnection.stayConnected', 'es')).toContain('ni se guardan en este dispositivo')
      expect(t('calendars.googleConnection.stayConnected', 'es')).toContain('sin internet no los verás')
      expect(t('calendars.googleConnection.disconnectBodyServer', 'es')).toContain('misma cuenta')
      expect(t('calendars.googleConnection.disconnectBodyServer', 'en')).toContain('same account')
    })

    it.each(SUPPORTED_LOCALES)('names where to remove access in %s, in both messages that cannot confirm it', (locale) => {
      expect(t('calendars.googleConnection.deleteAllGoogleOffline', locale)).toContain('myaccount.google.com/connections')
      expect(t('calendars.googleConnection.googleAccessMayRemain', locale)).toContain('myaccount.google.com/connections')
    })

    it.each(SUPPORTED_LOCALES)('never promises all devices or a copy of the events in %s', (locale) => {
      const text = serverTexts(locale).join('\n')
      expect(text).not.toMatch(/todos tus dispositivos|every device|all your devices|all devices|todos os (?:seus )?dispositivos|alle (?:deine )?Geräte|tous (?:tes|vos) appareils/iu)
      expect(text).not.toMatch(/\b(?:copy|copia|cópia|Kopie|copie)\b/iu)
    })

    it('has every server-mode text in every locale', () => {
      for (const locale of SUPPORTED_LOCALES) {
        for (const key of SERVER_KEYS) expect(t(`calendars.googleConnection.${key}`, locale), `${locale} ${key}`).not.toBe(`calendars.googleConnection.${key}`)
        for (const key of SERVER_MESSAGES) expect(t(`calendars.googleConnection.messages.${key}`, locale), `${locale} ${key}`).not.toBe(`calendars.googleConnection.messages.${key}`)
      }
    })
  })
})
