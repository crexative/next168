import { expect, it } from 'vitest'

const german = import.meta.glob<{ default: unknown }>('./de/*.json', { eager: true })
const french = import.meta.glob<{ default: unknown }>('./fr/*.json', { eager: true })
function strings(value: unknown): string[] {
  return typeof value === 'string' ? [value] : value && typeof value === 'object' ? Object.values(value).flatMap(strings) : []
}
it('addresses the person as du throughout German copy', () => {
  const formal = Object.entries(german).flatMap(([file, module]) => strings(module.default).filter((text) => /\b(?:Sie|Ihnen|Ihr(?:e|en|em|er|es)?)\b/.test(text)).map((text) => `${file}: ${text}`))
  expect(formal).toEqual([])
})

it('keeps the French informal voice used by setup throughout the other screens', () => {
  const formal = Object.entries(french).flatMap(([file, module]) => strings(module.default).filter((text) => /\b(?:vous|votre|vos)\b/i.test(text.replace(/rendez-vous/g, 'appointment'))).map((text) => `${file}: ${text}`))
  expect(formal).toEqual([])
})
