// Line normalization, applied before anything is parsed (tasks design addendum 6.1 F6): CRLF, CR and the Unicode line
// and paragraph separators become LF, each line is trimmed and empty lines are dropped. One line left is a single
// capture (L0 runs on it); two or more are a multi-line paste, which L0 never reads.
export function normalizeCaptureText(text: string): string[] {
  return text.replace(/\r\n?|[\u2028\u2029]/g, '\n').split('\n').map((line) => line.trim()).filter((line) => line.length > 0)
}
