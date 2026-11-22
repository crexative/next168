// A text field as tall as its text: titles wrap instead of being cut. The CSS max-height caps it, then it scrolls.
export function fitToContent(element: HTMLTextAreaElement | null | undefined): void {
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}
