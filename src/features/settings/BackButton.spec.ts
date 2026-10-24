// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import { i18n } from '@/i18n'
import BackButton from './BackButton.vue'
import { backTarget, trail, viewOfUrl } from './navigationTrail'

let host: HTMLElement | undefined
beforeEach(() => { trail.value = null; i18n.global.locale.value = 'en' })
afterEach(() => { host?.remove() })

function mount(props: Record<string, unknown>) {
  host = document.createElement('div')
  document.body.append(host)
  createApp(BackButton, props).use(i18n).mount(host)
  return host.querySelector<HTMLAnchorElement>('[data-testid=back-button]')!
}

it('names its destination and falls back when nothing is known', () => {
  const link = mount({ current: 'assistant', fallback: 'today' })
  expect(link.getAttribute('href')).toBe('#/today')
  expect(link.getAttribute('aria-label')).toBe('Back to Today')
  expect(link.textContent).toContain('Today')
  expect(link.getBoundingClientRect().height).toBeGreaterThanOrEqual(0)
})

it('returns to the screen the person came from', async () => {
  const link = mount({ current: 'assistant', fallback: 'today' })
  trail.value = { from: 'insights', to: 'assistant' }
  await nextTick()
  expect(link.getAttribute('href')).toBe('#/insights')
  expect(link.getAttribute('aria-label')).toBe('Back to Insights')
})

it('ignores a trail that does not end here or starts on an unknown screen', () => {
  expect(backTarget('assistant', 'today')).toBe('today')
  trail.value = { from: 'week', to: 'tasks' }
  expect(backTarget('assistant', 'today')).toBe('today')
  trail.value = { from: '', to: 'assistant' }
  expect(backTarget('assistant', 'today')).toBe('today')
  expect(viewOfUrl('http://x/#/settings/advanced')).toBe('settings')
  expect(viewOfUrl('http://x/')).toBe('')
})

it('can be pinned to a parent page', () => {
  const link = mount({ current: 'settings', fallback: 'settings', href: '#/settings', place: 'Settings' })
  expect(link.getAttribute('href')).toBe('#/settings')
  expect(link.getAttribute('aria-label')).toBe('Back to Settings')
})
