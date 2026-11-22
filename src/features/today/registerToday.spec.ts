// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import type { ShellRegistry, ViewDefinition } from '@/app/contracts'
import registerToday from './index'

// Hoy is a plain page on white (R_Hoy) and takes the wide measure on a desktop, its hero and list side by side.
it('registers Hoy as a plain page with the wide measure', () => {
  const views: ViewDefinition[] = []
  registerToday({ registerView: (view) => views.push(view), registerSettingsSection: () => {}, registerAddEntry: () => {} } as ShellRegistry)
  expect(views.map((view) => [view.id, view.backdrop, view.measure])).toEqual([['today', 'plain', 'wide']])
})
