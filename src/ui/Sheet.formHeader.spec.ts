import { describe, expect, it } from 'vitest'
import source from './Sheet.vue?raw'

// The form header's columns (R_HojaTarea, CI of #69): with a wide font "Hinzufügen" was cut, because the sides could
// shrink to nothing. Read from the component's styles, so the check also runs where no browser lays the sheet out (the
// review's mutant runner); visual-integrity measures it in a browser.
const css = source.slice(source.indexOf('<style'), source.indexOf('</style>'))
const rule = css.slice(css.indexOf('.sheet-header.is-form {'), css.indexOf('}', css.indexOf('.sheet-header.is-form {')))

describe('the sheet form header', () => {
  it('keeps "Cancel" and the action at least as wide as their words, and the title wraps between them', () => {
    expect(rule).toContain('grid-template-columns: minmax(max-content, 1fr) minmax(0, max-content) minmax(max-content, 1fr);')
  })
})
