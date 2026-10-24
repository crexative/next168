// "hasta las 7:00 a. m." but "hasta la 1:00 a. m.": Spanish and Portuguese put the article in agreement with the
// hour that is *read*. The clock text is already formatted for the person (12 or 24 h), so the leading hour is
// what decides. Messages carry both forms as "singular | plural"; the other languages ship one form.
export function readsAsOne(formattedClock: string): boolean {
  return /^0?1(?![\d])/.test(formattedClock.trim())
}

type Translate = (key: string, named: Record<string, unknown>, plural: number) => string

export function untilClock(t: (...args: never[]) => string, key: string, formattedClock: string): string {
  return (t as unknown as Translate)(key, { time: formattedClock }, readsAsOne(formattedClock) ? 1 : 2)
}
