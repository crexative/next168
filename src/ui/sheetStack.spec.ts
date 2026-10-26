import { afterEach, describe, expect, it } from 'vitest'
import { closedSheet, closingSheet, openSheet } from './sheetStack'

// verify12: a chooser that closed after the editor it opened had taken focus moved focus back to the page.
describe('sheets hand focus to each other', () => {
  afterEach(() => { document.body.replaceChildren() })

  const element = (tag: string, parent: HTMLElement = document.body) => {
    const node = document.createElement(tag)
    node.tabIndex = 0
    parent.append(node)
    return node
  }

  it('keeps focus in the next sheet while the first one finishes closing, then returns it to what opened the first', () => {
    const opener = element('button')
    opener.focus()
    const chooserPanel = element('div')
    const chooser = openSheet({ panel: () => chooserPanel })
    const row = element('button', chooserPanel)
    row.focus()
    // The row opens the editor, then the chooser starts closing.
    const editorPanel = element('div')
    const editor = openSheet({ panel: () => editorPanel })
    const title = element('h2', editorPanel)
    title.focus()
    closingSheet(chooser)
    expect(document.documentElement.dataset.sheetOpen).toBe('')
    chooserPanel.remove()
    closedSheet(chooser)
    expect(document.activeElement).toBe(title)
    closingSheet(editor)
    expect(document.documentElement.dataset.sheetOpen).toBeUndefined()
    editorPanel.remove()
    closedSheet(editor)
    expect(document.activeElement).toBe(opener)
  })

  it('leaves focus alone when something else took it while the sheet closed', () => {
    const opener = element('button')
    opener.focus()
    const panel = element('div')
    const sheet = openSheet({ panel: () => panel })
    const elsewhere = element('input')
    closingSheet(sheet)
    elsewhere.focus()
    closedSheet(sheet)
    expect(document.activeElement).toBe(elsewhere)
  })
})
