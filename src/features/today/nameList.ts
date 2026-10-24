interface ListFormatLike { format(items: readonly string[]): string }
type ListFormatConstructor = new (locale: string, options: { style: 'long'; type: 'conjunction' }) => ListFormatLike

// "A and B" / "A y B" / "A und B" in the app's language. The compiler's library predates Intl.ListFormat, so it is
// reached through a narrow type; every supported browser has it, and a plain comma list is the safe fallback.
export function nameList(locale: string, names: readonly string[]): string {
  const ListFormat = (Intl as unknown as { ListFormat?: ListFormatConstructor }).ListFormat
  return ListFormat ? new ListFormat(locale, { style: 'long', type: 'conjunction' }).format(names) : names.join(', ')
}
