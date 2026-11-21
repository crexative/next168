import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import AppShell from './AppShell.vue'
import { registerBuiltinViews } from './builtinViews'
import { shell } from './registry'
import { resetSidebar } from './sidebar'
import type { ViewId } from './contracts'

let mounted: Mounted | undefined
let originalUrl: string

beforeEach(() => {
  originalUrl = window.location.href
  resetSidebar()
  shell.views.clear()
  registerBuiltinViews(shell.registry)
  shell.registry.registerView({ id: 'assistant', titleKey: 'common.askAssistant', component: { render: () => h('p', 'Assistant') } })
})

afterEach(() => {
  mounted?.unmount()
  mounted = undefined
  shell.views.clear()
  resetSidebar()
  window.history.replaceState(null, '', originalUrl)
  vi.restoreAllMocks()
})

async function mountShell(hash: string, width = 900): Promise<HTMLElement> {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: width >= Number(query.match(/min-width: (\d+)px/)?.[1] ?? Infinity),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
  window.history.replaceState(null, '', hash)
  mounted = await mountWithPlanner(AppShell)
  return mounted.host
}

function expectOverlay(host: HTMLElement, open: boolean): void {
  expect(host.querySelector('.shell')?.getAttribute('data-sidebar')).toBe(open ? 'shown' : 'hidden')
  expect(host.querySelector('.content')?.hasAttribute('inert')).toBe(open)
  expect(host.querySelector('#app-sidebar')?.hasAttribute('inert')).toBe(!open)
  expect(host.querySelector('[data-testid=sidebar-toggle]')?.getAttribute('aria-expanded')).toBe(String(open))
  expect(host.querySelector('.sidebar-scrim')?.hasAttribute('data-open')).toBe(open)
}

async function openOverlay(host: HTMLElement): Promise<void> {
  host.querySelector<HTMLButtonElement>('[data-testid=sidebar-toggle]')!.click()
  await nextTick()
  expectOverlay(host, true)
}

it.each([768, 900, 1023])('closes the %i px overlay when Settings is selected from a Settings subpage', async (width) => {
  const host = await mountShell('#/settings/data', width)
  await openOverlay(host)

  host.querySelector<HTMLAnchorElement>('#app-sidebar a[href="#/settings"]')!.click()

  await vi.waitFor(() => expect(window.location.hash).toBe('#/settings'))
  await nextTick()
  expectOverlay(host, false)
  expect(host.querySelector('[data-view]')?.getAttribute('data-view')).toBe('settings')
})

const destinations: ViewId[] = ['today', 'week', 'tasks', 'insights', 'assistant', 'settings']

it.each(destinations)('closes the overlay when the current %s sidebar destination is selected again', async (id) => {
  const host = await mountShell(`#/${id}`)
  await openOverlay(host)
  const link = host.querySelector<HTMLAnchorElement>(`#app-sidebar a[href="#/${id}"]`)!
  expect(link.getAttribute('aria-current')).toBe('page')
  link.focus()

  link.click()

  await nextTick()
  expect(window.location.hash).toBe(`#/${id}`)
  expectOverlay(host, false)
  expect(document.activeElement).toBe(host.querySelector('[data-testid=sidebar-toggle]'))
})

it.each(['Escape', 'scrim'])('still closes the overlay through %s', async (method) => {
  const host = await mountShell('#/today')
  await openOverlay(host)

  if (method === 'Escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  else host.querySelector<HTMLElement>('.sidebar-scrim')!.click()

  await nextTick()
  expectOverlay(host, false)
})

it('still closes the overlay for navigation started outside the sidebar', async () => {
  const host = await mountShell('#/today')
  await openOverlay(host)

  window.location.hash = '#/tasks'
  window.dispatchEvent(new HashChangeEvent('hashchange'))

  await nextTick()
  expectOverlay(host, false)
})

it.each(destinations)('keeps the desktop sidebar visible when %s is selected', async (id) => {
  const host = await mountShell(`#/${id}`, 1024)

  host.querySelector<HTMLAnchorElement>(`#app-sidebar a[href="#/${id}"]`)!.click()

  await nextTick()
  expect(host.querySelector('.shell')?.getAttribute('data-sidebar')).toBe('shown')
  expect(host.querySelector('.content')?.hasAttribute('inert')).toBe(false)
})

// One "+" per device and navigation that never hides (redesign 2026-11, principles 4 and DIRECTION §3).
describe('the one "+" and the tabs', () => {
  const AddProbe = { props: ['view', 'placement'], render(this: { view: string; placement: string }) { return h('button', { 'data-testid': 'add-probe', 'data-view': this.view, 'data-placement': this.placement }) } }
  beforeEach(() => shell.registry.registerAddEntry({ component: AddProbe }))
  afterEach(() => { shell.addEntry.value = null })

  const probes = (host: HTMLElement) => [...host.querySelectorAll<HTMLElement>('[data-testid=add-probe]')].map((probe) => `${probe.dataset.view}:${probe.dataset.placement}`)

  it.each([
    [390, 'floating', '.tabbar-add'],
    [900, 'toolbar', '#toolbar-actions'],
    [1440, 'title', '.title-trailing'],
  ])('draws exactly one "+" at %i px: %s', async (width, placement, container) => {
    const host = await mountShell('#/week', width)
    await nextTick()
    expect(probes(host)).toEqual([`week:${placement}`])
    expect(host.querySelector(`${container} [data-testid=add-probe]`)).not.toBeNull()
  })

  it.each(['settings', 'assistant'])('draws no "+" on %s, which is not a tab', async (id) => {
    const host = await mountShell(`#/${id}`, 390)
    await nextTick()
    expect(probes(host)).toEqual([])
  })

  it('shows the tabs in the toolbar on a tablet and when the desktop sidebar is hidden, never beside a shown sidebar', async () => {
    let host = await mountShell('#/tasks', 900)
    await nextTick()
    const current = () => host.querySelector('[data-testid=top-tabs] [aria-current=page]')?.textContent?.trim()
    expect(host.querySelectorAll('[data-testid=top-tabs] a')).toHaveLength(4)
    expect(current()).toBe('Tasks')
    mounted?.unmount()
    host = await mountShell('#/tasks', 1440)
    await nextTick()
    expect(host.querySelector('[data-testid=top-tabs]')).toBeNull()
    host.querySelector<HTMLButtonElement>('[data-testid=sidebar-toggle]')!.click()
    await nextTick()
    expect(current()).toBe('Tasks')
  })

  it('paints the page white only for a view that declares a plain backdrop', async () => {
    shell.registry.registerView({ id: 'tasks', titleKey: 'app.tabs.tasks', icon: 'list-checks', tabOrder: 2, backdrop: 'plain', component: { render: () => h('p', 'Tasks') } })
    await mountShell('#/tasks', 390)
    await nextTick()
    expect(document.documentElement.dataset.backdrop).toBe('plain')
    window.location.hash = '#/settings'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    await vi.waitFor(() => expect(document.documentElement.dataset.backdrop).toBeUndefined())
  })
})
