import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

// verify4 defect 9: copy built with a raw "HH:MM" or its own Intl clock ignored the 12/24 h setting
// ("Recordarme a las 22:00", "18:00–19:00" in a proposal). Every time a person reads goes through clockFormat in
// ui/format.ts; a raw 24-hour clock is allowed only where a machine reads it.
const ROOT = join(__dirname, '..')

function sources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sources(path)
    return /\.(ts|vue)$/.test(entry.name) && !/\.(spec|test)\.ts$/.test(entry.name) && !path.includes('__tests__') ? [path] : []
  })
}

const files = sources(ROOT).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }))

// Each of these writes one 24-hour clock for a machine: a time field's value, or text an AI model reads.
const MACHINE_CLOCKS: Record<string, string> = {
  'features/assistant/changeIntent.ts': 'the on-device model prompt (start and end as 24-hour HH:MM)',
  'features/assistant/anyAi/buildPrompt.ts': 'the prompt pasted into a chat AI',
  'features/calendars/eventDraft.ts': 'the value of an <input type="time">',
  'features/week/localTime.ts': 'the value of an <input type="time">',
  'features/checkin/checkInForm.ts': 'the value of an <input type="time">',
  'features/tasks/taskDraft.ts': 'the value of an <input type="time"> (a fixed start)',
}

describe('every clock time a person reads follows the 12/24 h setting', () => {
  it('builds a raw HH:MM only where a machine reads it', () => {
    const raw = files.filter((file) => /padStart\(2, '0'\)\}:\$\{/.test(file.text)).map((file) => file.path).sort()
    expect(raw).toEqual(Object.keys(MACHINE_CLOCKS).sort())
  })

  it('in the on-device assistant, the 24-hour clock feeds the model prompt only, never a summary', () => {
    const text = files.find((file) => file.path === 'features/assistant/changeIntent.ts')!.text
    const uses = text.split('\n').filter((line) => /(^|[^A-Za-z.])clock\(/.test(line) && !/function clock\(/.test(line))
    expect(uses).toHaveLength(1)
    expect(uses[0]).toContain('start: clock(block.start), end: clock(block.end)')
  })

  it('formats a time of day with Intl only through clockFormat, or for a machine on a fixed 24-hour clock', () => {
    const offending = files.flatMap((file) => file.text.split('\n').flatMap((line, index) => {
      if (!/new Intl\.DateTimeFormat\(/.test(line) || !/\b(hour|timeStyle)\b/.test(line)) return []
      if (file.path === 'ui/format.ts' && line.includes('clockLocale(locale)')) return []
      if (/hourCycle: 'h23'/.test(line)) return []
      return [`${file.path}:${index + 1}`]
    }))
    expect(offending).toEqual([])
  })
})
