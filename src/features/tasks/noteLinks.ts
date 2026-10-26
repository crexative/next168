// The web links inside a note (tasks design rev 2.1 §3, P1-5): only http and https, each opened with
// rel="noopener noreferrer". Anything else (javascript:, data:, file:, a bare domain) stays plain text.
const CANDIDATE = /\bhttps?:\/\/[^\s<>"'«»“”‘’]+/gi
const TRAILING = /[.,;:!?)\]}]+$/
const MAX_LINKS = 5

export function noteLinks(note: string): string[] {
  const links: string[] = []
  for (const match of note.matchAll(CANDIDATE)) {
    const text = match[0].replace(TRAILING, '')
    let url: URL
    try { url = new URL(text) } catch { continue }
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || links.includes(url.href)) continue
    links.push(url.href)
    if (links.length === MAX_LINKS) break
  }
  return links
}
