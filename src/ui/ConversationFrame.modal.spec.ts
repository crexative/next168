import { describe, expect, it } from 'vitest'
import source from './ConversationFrame.vue?raw'
import dayPicker from '@/features/onboarding/setup/DayPicker.vue?raw'
import setupAnswer from '@/features/onboarding/setup/SetupAnswer.vue?raw'
import setupConversation from '@/features/onboarding/setup/SetupConversation.vue?raw'

// The modal frame's contract (DIRECTION §4, review of #65), read from the component's own styles: the e2e
// (today-checkin, ios-keyboard, setup-guided) measure it in a browser; this check fails at once when a rule is lost,
// also where no browser runs (the review's mutant runner).
const css = source.slice(source.indexOf('<style scoped>'), source.indexOf('</style>'))
const MODAL_QUERY = '@media (min-width: 768px) and (min-height: 700px)'

function block(text: string, opener: string): string {
  const start = text.indexOf(opener)
  if (start === -1) return ''
  let depth = 0
  for (let index = text.indexOf('{', start); index < text.length; index++) {
    if (text[index] === '{') depth++
    if (text[index] === '}' && --depth === 0) return text.slice(start, index + 1)
  }
  return ''
}
const declarations = (rule: string) => Object.fromEntries(rule.slice(rule.indexOf('{') + 1, rule.lastIndexOf('}')).replace(/\/\*[\s\S]*?\*\//g, '').split(';')
  .map((part) => part.trim()).filter((part) => part.includes(':') && !part.includes('{'))
  .map((part) => [part.slice(0, part.indexOf(':')).trim(), part.slice(part.indexOf(':') + 1).trim()]))

describe('the conversation as a centred modal', () => {
  const media = block(css, MODAL_QUERY)
  const frame = declarations(block(media, '.setup-frame {'))

  it('applies only from 768 px wide and 700 px high: a small landscape tablet keeps the full screen', () => {
    expect(media).not.toBe('')
  })

  it('is 560 px wide (35rem) with pixel margins, centred in the visible viewport and capped at 736 px', () => {
    expect(frame.width).toBe('min(35rem, 100vw - 32px)')
    expect(frame['margin-inline']).toBe('auto')
    expect(frame['--modal-room']).toBe('min(var(--vv-height, 100dvh), 100dvh)')
    expect(frame.top).toBe('calc(var(--vv-top, 0px) + var(--modal-room) / 2)')
    expect(frame.translate).toBe('0 -50%')
    expect(frame.height).toBe('auto')
    expect(frame['--frame-room']).toBe('min(736px, var(--modal-room) - 32px)')
    expect(frame['max-height']).toBe('var(--frame-room)')
  })

  it('dims the page with the scrim token and drops the top safe area inside the card', () => {
    expect(frame['box-shadow']).toContain('var(--scrim)')
    expect(declarations(block(media, '.bar {'))['padding-top']).toBe('0')
  })
})

// In the 560 px modal the seven day toggles keep their names whole (6 + 1), also with Linux's wider fonts.
it('day toggles are at least 4.25em wide', () => {
  expect(dayPicker).toContain('.toggles { display: grid; grid-template-columns: repeat(auto-fit, minmax(max(var(--tap-target), 4.25em), 1fr));')
})

// CI of #60: with "Elegir días" open, the answer dock outgrew the 736 px modal and the frame cut "Siguiente". The dock's
// share is of the frame; it keeps its size there (its answers scroll inside it, its actions never shrink out of it), and
// that size is its own, not a parent's rule. setup-guided measures the same in a tablet browser, visual-integrity on a
// 320 px phone at 200 % text.
describe('the safe area inside the modal', () => {
  it('is zero inside the centred card, which touches no edge of the screen', () => {
    const frame = declarations(block(block(css, MODAL_QUERY), '.setup-frame {'))
    expect([frame['--safe-top'], frame['--safe-right'], frame['--safe-bottom'], frame['--safe-left']]).toEqual(['0px', '0px', '0px', '0px'])
  })
  it('stays the screen\'s own outside the modal (the full-screen frame on a phone)', () => {
    expect(declarations(block(css, '.setup-frame {'))['--safe-bottom']).toBeUndefined()
  })
})

describe('the guided setup dock inside the modal', () => {
  const styles = (text: string) => text.slice(text.indexOf('<style scoped>'), text.indexOf('</style>'))
  it('takes its share of the frame, not of the screen behind the modal', () => {
    expect(declarations(block(css, '.setup-frame {'))['--frame-room']).toBe('min(var(--vv-height, 100dvh), 100dvh)')
    const dock = declarations(block(styles(setupAnswer), '.dock {'))
    expect(dock['max-height']).toBe('calc(var(--frame-room, min(var(--vv-height, 100dvh), 100dvh)) * 0.66)')
    expect(dock.flex).toBe('none')
  })
  it('is not sized by the conversation, whose own rule is for the summary dock only', () => {
    expect(styles(setupConversation)).not.toMatch(/(^|\n)\.dock \{/)
    expect(declarations(block(styles(setupConversation), '.dock.is-summary {')).flex).toBe('none')
  })
})
