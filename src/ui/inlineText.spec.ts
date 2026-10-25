import { describe, expect, it } from 'vitest'
import { inlineSeparators, joinInline } from './inlineText'

describe('inline separators', () => {
  it('keep the separator with the word before it, and leave the space after it breakable', () => {
    expect(inlineSeparators('103 h asignadas · 65 h sin asignar')).toBe('103 h asignadas\u00a0· 65 h sin asignar')
    expect(joinInline(['a', '', 'b', 'c'])).toBe('a\u00a0· b\u00a0· c')
  })

  it('never makes two figures one unbreakable run', () => {
    const text = inlineSeparators('68 h asignadas · 100 h sin asignar')
    expect(text).toMatch(/· /)
    expect(text).not.toContain('·\u00a0')
    expect(text).not.toMatch(/(?<!\u00a0)·/)
  })
})
