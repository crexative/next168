// Puts text on the clipboard. False when the browser has no Clipboard API or refuses (no permission, insecure
// page, no user gesture): the caller then shows the text so the person can copy it by hand.
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
