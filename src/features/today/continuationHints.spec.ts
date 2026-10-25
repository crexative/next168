import { describe, expect, it } from 'vitest'
import { createI18n } from 'vue-i18n'
import { i18n, SUPPORTED_LOCALES } from '@/i18n'
import { plannerDocument, sleep } from '@/features/week/testDocument'
import { buildTimeline } from './todayTimeline'
import { continuationHints as rawHints } from './continuationHints'

// ICU separates the clock from "AM" with a narrow no-break space on some platforms; the text is compared with plain spaces.
const continuationHints: typeof rawHints = (...args) => rawHints(...args).map((hint) => (
  hint.params.time ? { ...hint, params: { time: hint.params.time.replace(/\s/g, ' ') } } : hint
))

const now = new Date('2026-10-24T12:00:00Z')
const multiDay = { start: '2026-10-22T18:00:00Z', end: '2026-10-27T09:00:00Z' }

describe('timeline continuation hints', () => {
  it('distinguishes both adjacent-day overnight block occurrences', () => {
    const { items } = buildTimeline({
      document: plannerDocument({ blocks: [sleep] }), today: '2026-10-24',
      timeZone: 'UTC', external: [], placements: [],
    })
    expect(items).toHaveLength(2)
    expect(items.map(item => continuationHints(item, now, 'UTC', 'en'))).toEqual([
      [{ key: 'today.timeline.sinceYesterday', params: {} }],
      [{ key: 'today.timeline.untilTime', params: { time: '6:00 AM' }, plural: 2 }],
    ])
  })

  it('shows both real dates for the five-day timed event', () => {
    expect(continuationHints(multiDay, now, 'UTC', 'es')).toEqual([
      { key: 'today.timeline.sinceDate', params: { date: 'jue\u00a022' } },
      { key: 'today.timeline.untilDate', params: { date: 'mar\u00a027' } },
    ])
  })

  it('shows both adjacent hints when an event crosses both day boundaries', () => {
    expect(continuationHints({ start: '2026-10-23T23:00:00Z', end: '2026-10-25T06:00:00Z' }, now, 'UTC', 'en')).toEqual([
      { key: 'today.timeline.sinceYesterday', params: {} },
      { key: 'today.timeline.untilTime', params: { time: '6:00 AM' }, plural: 2 },
    ])
  })

  it('shows no hint for an event starting and ending today', () => {
    expect(continuationHints({ start: '2026-10-24T09:00:00Z', end: '2026-10-24T18:00:00Z' }, now, 'UTC', 'en')).toEqual([])
  })

  it('uses the planner zone when both UTC dates are today', () => {
    expect(continuationHints({ start: '2026-10-24T02:00:00Z', end: '2026-10-24T18:00:00Z' }, now, 'America/Bogota', 'es')).toEqual([
      { key: 'today.timeline.sinceYesterday', params: {} },
    ])
  })

  it('does not show hints when different UTC dates fall on the same local day', () => {
    expect(continuationHints({ start: '2026-10-24T10:00:00Z', end: '2026-10-25T02:00:00Z' }, now, 'America/Bogota', 'en')).toEqual([])
  })

  it('formats the endpoint dates in the planner zone', () => {
    expect(continuationHints({ start: '2026-10-23T02:00:00Z', end: '2026-10-27T02:00:00Z' }, now, 'America/Bogota', 'es')).toEqual([
      { key: 'today.timeline.sinceDate', params: { date: 'jue\u00a022' } },
      { key: 'today.timeline.untilDate', params: { date: 'lun\u00a026' } },
    ])
  })

  it('recognizes yesterday across the 25-hour daylight-saving day', () => {
    expect(continuationHints(
      { start: '2026-11-01T04:30:00Z', end: '2026-11-02T12:00:00Z' },
      new Date('2026-11-02T17:00:00Z'), 'America/New_York', 'en',
    )).toEqual([{ key: 'today.timeline.sinceYesterday', params: {} }])
  })

  it('recognizes tomorrow across the 23-hour daylight-saving day', () => {
    expect(continuationHints(
      { start: '2026-03-08T06:00:00Z', end: '2026-03-09T04:30:00Z' },
      new Date('2026-03-08T16:00:00Z'), 'America/New_York', 'en',
    )).toEqual([{ key: 'today.timeline.untilTime', params: { time: '12:30 AM' }, plural: 2 }])
  })

  it('recognizes adjacent dates across a year boundary', () => {
    expect(continuationHints(
      { start: '2026-12-31T18:00:00Z', end: '2027-01-02T09:00:00Z' },
      new Date('2027-01-01T12:00:00Z'), 'UTC', 'en',
    )).toEqual([
      { key: 'today.timeline.sinceYesterday', params: {} },
      { key: 'today.timeline.untilTime', params: { time: '9:00 AM' }, plural: 2 },
    ])
  })

  it('shows no continuation for an end at tomorrow’s local midnight', () => {
    expect(continuationHints({ start: '2026-10-24T09:00:00Z', end: '2026-10-25T00:00:00Z' }, now, 'UTC', 'en')).toEqual([])
  })

  it.each([
    ['UTC', '2026-10-25T00:00:00.000Z'],
    ['America/Bogota', '2026-10-25T05:00:00.000Z'],
  ])('uses half-open intervals around local midnight in %s', (timeZone, midnight) => {
    const boundary = Date.parse(midnight)
    const start = '2026-10-24T09:00:00Z'
    expect(continuationHints({ start, end: new Date(boundary - 1).toISOString() }, now, timeZone, 'en')).toEqual([])
    expect(continuationHints({ start, end: midnight }, now, timeZone, 'en')).toEqual([])
    expect(continuationHints({ start, end: new Date(boundary + 1).toISOString() }, now, timeZone, 'en')).toEqual([
      { key: 'today.timeline.untilTime', params: { time: '12:00 AM' }, plural: 2 },
    ])
  })

  it('still shows until tomorrow for an overnight event ending at 07:00', () => {
    expect(continuationHints({ start: '2026-10-24T23:00:00Z', end: '2026-10-25T07:00:00Z' }, now, 'UTC', 'en')).toEqual([
      { key: 'today.timeline.untilTime', params: { time: '7:00 AM' }, plural: 2 },
    ])
  })

  it('reads the end in the person’s clock and picks the singular article for one o’clock', () => {
    const item = { start: '2026-10-24T22:00:00Z', end: '2026-10-25T01:00:00Z' }
    expect(continuationHints(item, now, 'UTC', 'es', 'es-CO')).toEqual([{ key: 'today.timeline.untilTime', params: { time: '1:00 a. m.' }, plural: 1 }])
    expect(continuationHints(item, now, 'UTC', 'es', 'es-ES-u-hc-h23')).toEqual([{ key: 'today.timeline.untilTime', params: { time: '1:00' }, plural: 1 }])
    expect(continuationHints({ ...item, end: '2026-10-25T13:00:00Z' }, now, 'UTC', 'es', 'es-ES-u-hc-h23')).toEqual([{ key: 'today.timeline.untilTime', params: { time: '13:00' }, plural: 2 }])
  })

  it.each([
    ['UTC', '2026-10-26T00:00:00Z'],
    ['America/Bogota', '2026-10-26T05:00:00Z'],
  ])('shows the last covered date for an end at midnight two days later in %s', (timeZone, end) => {
    expect(continuationHints({ start: '2026-10-24T09:00:00Z', end }, now, timeZone, 'en')).toEqual([
      { key: 'today.timeline.untilDate', params: { date: '25\u00a0Sun' } },
    ])
  })

  it('does not treat a start at today’s local midnight as yesterday', () => {
    expect(continuationHints({ start: '2026-10-24T00:00:00Z', end: '2026-10-24T18:00:00Z' }, now, 'UTC', 'en')).toEqual([])
  })

  it.each([
    ['en', 'Since 22\u00a0Thu', 'Until 27\u00a0Tue'],
    ['es', 'Desde el jue\u00a022', 'Hasta el mar\u00a027'],
    ['fr', 'Depuis le jeu.\u00a022', 'Jusqu’au mar.\u00a027'],
    ['pt', 'Desde qui.,\u00a022', 'Até ter.,\u00a027'],
    ['de', 'Seit Do.,\u00a022.', 'Bis Di.,\u00a027.'],
  ])('interpolates both date hints in %s without a fallback', (locale, since, until) => {
    const translator = createI18n({
      legacy: false, locale, fallbackLocale: false,
      messages: { [locale]: i18n.global.getLocaleMessage(locale) },
    }).global
    const hints = continuationHints(multiDay, now, 'UTC', locale)
    for (const key of ['sinceYesterday', 'untilTime', 'sinceDate', 'untilDate']) {
      expect(translator.te(`today.timeline.${key}`)).toBe(true)
    }
    expect(hints.map(hint => translator.t(hint.key, hint.params))).toEqual([since, until])
    expect(SUPPORTED_LOCALES).toContain(locale)
  })
})
