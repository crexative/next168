// A separator travels with the words on both sides; the rest of each item can still wrap.
export function inlineSeparators(text: string): string {
  return text.replace(/\s+·\s+/g, '\u00a0·\u00a0')
}

export function joinInline(parts: readonly string[]): string {
  return inlineSeparators(parts.filter(Boolean).join(' · '))
}

export function unbreakable(text: string): string {
  return text.replace(/\s/g, '\u00a0')
}
