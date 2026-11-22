// @vitest-environment happy-dom
import { expect, it } from 'vitest'
import type { ShellRegistry, ViewDefinition } from '@/app/contracts'
import registerWeek from './index'

// Week is a plain page on white (R_Semana), like the other redesigned tabs.
it('registers Week as a plain page', () => {
  const views: ViewDefinition[] = []
  registerWeek({ registerView: (view) => views.push(view), registerSettingsSection: () => {}, registerAddEntry: () => {} } as ShellRegistry)
  expect(views.map((view) => [view.id, view.backdrop])).toEqual([['week', 'plain']])
})
