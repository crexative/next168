// Date text for the summary's subtitle and ranges.

// A range of two numbers takes its dash without spaces ("16–22 nov", REVIEW B2), whatever the locale's formatRange
// gives ("Nov 16 – 22" in English, "16 – 22 de nov." in Portuguese). A range across months keeps its spaced dash,
// where each side is a whole date ("28 oct – 3 nov").
export function tightRange(text: string): string {
  return text.replace(/(\d)\s+–\s+(\d)/g, '$1–$2')
}

// The day of the month alone, as the locale writes it before a month ("16." in German, "16" elsewhere).
export function dayOfMonth(date: string, locale: string): string {
  const parts = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: 'UTC' }).formatToParts(new Date(`${date}T12:00:00Z`))
  const at = parts.findIndex((part) => part.type === 'day')
  const next = parts[at + 1]
  // Only the punctuation that belongs to the number ("16." in German) stays; words and spaces ("16 de") do not.
  const mark = next && next.type === 'literal' && parts[at + 2]?.type === 'month' ? next.value.replace(/[\s\p{L}]/gu, '') : ''
  return `${parts[at]?.value ?? ''}${mark}`
}
