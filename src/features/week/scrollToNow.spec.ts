// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { scrollToNow } from './scrollToNow'

// happy-dom has no layout: each element's box is given, and only the sticky ones count as covering the page.
function box(element: HTMLElement, top: number, height: number): HTMLElement {
  element.getBoundingClientRect = () => ({ top, bottom: top + height, height, left: 0, right: 390, width: 390, x: 0, y: top, toJSON: () => ({}) })
  element.getClientRects = () => [element.getBoundingClientRect()] as unknown as DOMRectList
  return element
}
function sticky(top: number, height: number): HTMLElement {
  const element = document.createElement('div')
  element.style.position = 'sticky'
  element.style.top = `${top}px`
  return box(element, top, height)
}

afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks() })

describe('Week opens with now in the middle of what the sticky header leaves (review of #56)', () => {
  it('counts every sticky strip where it will stay (its top plus its height) and centres the line under the lowest', () => {
    vi.stubGlobal('innerHeight', 375)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const root = document.createElement('div')
    // The head under a 52 px toolbar, and the day strip under the head: it ends at 52 + 100 + 90 = 242.
    root.append(sticky(52, 100), sticky(152, 90), box(document.createElement('div'), 400, 2000))
    document.body.append(root)
    const line = box(document.createElement('div'), 1000, 2)
    scrollToNow(line, root)
    // 1000 - 242 - (375 - 242) / 2
    expect(scrollTo).toHaveBeenCalledWith({ top: 691.5, behavior: 'instant' })
  })

  it('never scrolls above the top of the page', () => {
    vi.stubGlobal('innerHeight', 844)
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const root = document.createElement('div')
    root.append(sticky(0, 120))
    document.body.append(root)
    scrollToNow(box(document.createElement('div'), 200, 2), root)
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'instant' })
  })
})
