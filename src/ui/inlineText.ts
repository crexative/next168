// A separator never starts a line: a no-break space keeps it with the word before, and the ordinary space after it is
// where the line may break. The rest of each item can still wrap.
export function inlineSeparators(text: string): string {
  return text.replace(/\s+·\s+/g, '\u00a0· ')
}

export function joinInline(parts: readonly string[]): string {
  return inlineSeparators(parts.filter(Boolean).join(' · '))
}

export function unbreakable(text: string): string {
  return text.replace(/\s/g, '\u00a0')
}
