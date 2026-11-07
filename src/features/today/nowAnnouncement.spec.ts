// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref, watch, type App } from 'vue'
import { i18n } from '@/i18n'
import { announcement, cancelAnnouncements } from '@/ui/announcer'
import { nowAnnouncement, useNowAnnouncements } from './nowAnnouncement'
import { buildNowState, type NowState } from './nowState'
import { at, block } from './timelineFixtures'

const t = (key: string, named?: Record<string, unknown>, plural?: number) => (plural === undefined ? i18n.global.t(key, named ?? {}) : i18n.global.t(key, named ?? {}, plural)) as string

beforeEach(() => { i18n.global.locale.value = 'es' })
afterEach(() => { i18n.global.locale.value = 'en' })

describe('nowAnnouncement', () => {
  it('speaks a change of Now with the article agreed to the hour', () => {
    expect(nowAnnouncement(t, { changed: { title: 'Libre', until: '11:00 p. m.' } })).toBe('Ahora: Libre, hasta las 11:00 p. m.')
    expect(nowAnnouncement(t, { changed: { title: 'Libre', until: '1:00 p. m.' } })).toBe('Ahora: Libre, hasta la 1:00 p. m.')
    expect(nowAnnouncement(t, { changed: { title: 'Libre' } })).toBe('Ahora: Libre')
  })

  it('speaks a new question alone', () => {
    expect(nowAnnouncement(t, { askTitle: 'Proyecto personal' })).toBe('Puedes marcar cómo fue Proyecto personal')
  })

  it('joins a change of Now and a new question of one refresh into one message (check 27)', () => {
    expect(nowAnnouncement(t, { changed: { title: 'Libre', until: '11:00 p. m.' }, askTitle: 'Proyecto personal' }))
      .toBe('Ahora: Libre, hasta las 11:00 p. m.. Puedes marcar cómo fue Proyecto personal')
  })

  it('says nothing when nothing changed', () => {
    expect(nowAnnouncement(t, {})).toBe('')
  })
})

const project = block('project', '19:00', '20:00', 'Proyecto personal')
const sleep = block('sleep', '23:00', '23:59', 'Dormir')

function stateAt(time: string): NowState {
  return buildNowState({
    items: [project, sleep], upcoming: [project, sleep], actuals: [], since: at('00:00').getTime(), now: at(time),
    today: '2026-11-06', timeZone: 'UTC', closeDayOpen: false,
  })
}

describe('useNowAnnouncements', () => {
  let app: App
  let host: HTMLElement
  const spoken: string[] = []

  function mount(initial: string, loaded = true) {
    const state = ref(stateAt(initial))
    const zone = ref('UTC')
    const ready = ref(loaded)
    const Probe = defineComponent({ setup() { useNowAnnouncements(state, zone, ready); return () => h('div') } })
    host = document.createElement('div')
    app = createApp(Probe).use(i18n)
    app.mount(host)
    return Object.assign(state, { ready })
  }

  async function settle() {
    await nextTick()
    await vi.advanceTimersByTimeAsync(400)
  }

  let stopListening = () => {}
beforeEach(() => {
  vi.useFakeTimers()
  spoken.length = 0
  cancelAnnouncements()
  // Each time the live region takes a new message counts as one spoken announcement.
  stopListening = watch(announcement, (text) => { if (text) spoken.push(text) }, { flush: 'sync' })
})
  afterEach(() => { stopListening(); app.unmount(); cancelAnnouncements(); vi.useRealTimers(); Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' }) })

  it('says nothing on first render nor while the minutes count down', async () => {
    const state = mount('19:19')
    await settle()
    for (const time of ['19:25', '19:30', '19:49']) { state.value = stateAt(time); await settle() }
    expect(spoken).toEqual([])
  })

  it('treats the state that appears when the planner finishes loading as the first render, not a change', async () => {
    const state = mount('19:19', false)
    state.value = stateAt('20:30')
    await settle()
    state.ready.value = true
    await settle()
    state.value = stateAt('20:31')
    await settle()
    expect(spoken).toEqual([])
    state.value = stateAt('23:00')
    await settle()
    expect(spoken).toHaveLength(1)
  })

  it('announces a boundary once, however many refreshes follow it', async () => {
    const state = mount('19:55')
    for (const time of ['20:00', '20:01', '20:05', '20:10']) { state.value = stateAt(time); await settle() }
    // 20:00 changes Now (Libre); the question about Proyecto personal was already offered from 19:50, hence not new here.
    expect(spoken).toHaveLength(1)
    expect(spoken[0]).toMatch(/^Ahora: Libre, hasta las \d/)
  })

  it('announces the new question once when the ten-minute mark is reached', async () => {
    const state = mount('19:49')
    state.value = stateAt('19:50')
    await settle()
    state.value = stateAt('19:55')
    await settle()
    expect(spoken).toEqual(['Puedes marcar cómo fue Proyecto personal'])
  })

  it('records a change silently while the tab is hidden and on the refresh that returns', async () => {
    const state = mount('19:49')
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' })
    state.value = stateAt('20:00')
    await settle()
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    state.value = stateAt('20:01')
    await settle()
    state.value = stateAt('20:02')
    await settle()
    expect(spoken).toEqual([])
  })
})
