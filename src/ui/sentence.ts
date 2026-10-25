// Sentences put together from parts whose ending is not known in advance: a time written "10:00 p. m." already ends
// with a period, a question with "?". These never add a second mark ("p. m..", "anoche?.").
const ENDS_A_SENTENCE = /[.!?…。]$/u

export function endSentence(text: string): string {
  const trimmed = text.trimEnd()
  return ENDS_A_SENTENCE.test(trimmed) ? trimmed : `${trimmed}.`
}

// A message whose own period follows a value that already ended with one ("Se cruza con Sueño: 10:00 p. m..").
export function withoutDoubledPeriod(text: string): string {
  return text.replace(/([^.])\.\.(?!\.)/gu, '$1.')
}
