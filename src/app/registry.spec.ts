import { describe, expect, it, vi } from 'vitest'
import { h } from 'vue'
import { registerFeatures } from './features'
import { createShellRegistry } from './registry'
import { DEFAULT_VIEW, parseHash, viewHash } from './useHashRoute'
import { registerBuiltinViews } from './builtinViews'

const component = { render: () => h('div') }

describe('shell registry', () => {
  it('orders tabs by tabOrder and leaves views without it out of the tab bar', () => {
    const { registry, tabs } = createShellRegistry()
    registry.registerView({ id: 'insights', component, titleKey: 'a', icon: 'x', tabOrder: 3 })
    registry.registerView({ id: 'today', component, titleKey: 'b', icon: 'y', tabOrder: 0 })
    registry.registerView({ id: 'checkin', component, titleKey: 'c' })
    expect(tabs.value.map((view) => view.id)).toEqual(['today', 'insights'])
  })

  it('lets a feature replace a placeholder view and orders settings sections', () => {
    const { registry, views, settingsSections } = createShellRegistry()
    registerBuiltinViews(registry)
    const feature = { render: () => h('section') }
    registry.registerView({ id: 'week', component: feature, titleKey: 'app.tabs.week', icon: 'calendar-days', tabOrder: 1 })
    expect(views.get('week')?.component).toBe(feature)
    expect(views.size).toBe(5)

    registry.registerSettingsSection({ id: 'data', component, titleKey: 'k', order: 20 })
    registry.registerSettingsSection({ id: 'language', component, titleKey: 'k', order: 10 })
    // Language and region lives inside Settings → Integrations and advanced, so the shell adds no section of its own.
    expect(settingsSections.value.map((section) => section.id)).toEqual(['language', 'data'])
  })

  it('registers every feature module with the same registry', () => {
    const { registry } = createShellRegistry()
    const register = vi.fn()
    registerFeatures(registry, { a: { default: register }, b: { default: register } })
    expect(register).toHaveBeenCalledTimes(2)
    expect(register).toHaveBeenCalledWith(registry)
  })
})

describe('hash routing', () => {
  const known = new Set(['today', 'week', 'settings'])

  it('maps hashes to views and falls back to the default', () => {
    expect(parseHash('#/week', known)).toBe('week')
    expect(parseHash('#/settings/data', known)).toBe('settings')
    expect(parseHash('', known)).toBe(DEFAULT_VIEW)
    expect(parseHash('#/unknown', known)).toBe(DEFAULT_VIEW)
    expect(viewHash('tasks')).toBe('#/tasks')
  })
})
