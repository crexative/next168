import { describe, expect, it } from 'vitest'
import { MigrationError, migrateToCurrent, nearestColorKey } from './legacyMigration'

const context = { now: new Date('2026-10-24T12:00:00.000Z'), locale: 'es', timeZone: 'America/Bogota', tutorialCompleted: false, newId: () => 'workspace-x' }

describe('legacy v1 migration', () => {
  it('maps v1 fields without losing data', () => {
    const document = migrateToCurrent({
      categories: [{ id: 'c1', name: ' Sleep ', color: '#8b5cf6', weeklyHourLimit: 56, icon: '😴' }],
      timeBlocks: [
        { id: 'b1', categoryId: 'c1', title: 'Sleep', description: 'early', dayOfWeek: 0, startTime: '22:30', endTime: '06:30', durationMinutes: 480, repeatDays: [0, 1, 1, 2] },
      ],
    }, context)
    expect(document.categories[0]).toEqual({ id: 'c1', name: 'Sleep', colorKey: 'purple', customColor: '#8b5cf6', icon: '😴', goal: { type: 'max', hoursPerWeek: 56 } })
    expect(document.blocks[0]).toEqual({ id: 'b1', categoryId: 'c1', title: 'Sleep', notes: 'early', days: [0, 1, 2], start: 1350, end: 390 })
    expect(document.settings).toMatchObject({ locale: 'es', timeZone: 'America/Bogota', onboardingDone: true })
    expect(document).toMatchObject({ workspaceId: 'workspace-x', revision: 0, schemaVersion: 2 })
  })

  it('marks onboarding done when the tutorial was completed even with no data', () => {
    expect(migrateToCurrent({ categories: [], timeBlocks: [] }, context).settings.onboardingDone).toBe(false)
    expect(migrateToCurrent({ categories: [], timeBlocks: [] }, { ...context, tutorialCompleted: true }).settings.onboardingDone).toBe(true)
  })

  it('drops only blocks that cannot be represented', () => {
    const document = migrateToCurrent({
      categories: [{ id: 'c1', name: 'A', color: '#10b981', weeklyHourLimit: 10 }],
      timeBlocks: [
        { id: 'ok', categoryId: 'c1', title: 'ok', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
        { id: 'zero', categoryId: 'c1', title: 'zero', dayOfWeek: 1, startTime: '09:00', endTime: '09:00' },
        { id: 'orphan', categoryId: 'missing', title: 'orphan', dayOfWeek: 1, startTime: '09:00', endTime: '10:00' },
      ],
    }, context)
    expect(document.blocks.map((block) => block.id)).toEqual(['ok'])
  })

  it('rejects data that is not v1-shaped', () => {
    expect(() => migrateToCurrent({ categories: 'x' }, context)).toThrow(MigrationError)
  })

  it('maps hex colors to the nearest palette key', () => {
    expect(nearestColorKey('#10b981')).toBe('green')
    expect(nearestColorKey('#f59e0b')).toBe('orange')
    expect(nearestColorKey('#6366f1')).toBe('purple')
  })
})
