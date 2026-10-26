import { describe, expect, it } from 'vitest'
import { noteLinks } from './noteLinks'

describe('links inside a note', () => {
  it('finds http and https links, without trailing punctuation, once each', () => {
    expect(noteLinks('Formulario: https://example.invalid/form?id=1. Ver también (http://example.invalid/b), y https://example.invalid/form?id=1'))
      .toEqual(['https://example.invalid/form?id=1', 'http://example.invalid/b'])
  })

  it('never turns another scheme or a bare domain into a link', () => {
    expect(noteLinks('javascript:alert(1) data:text/html,x file:///etc/passwd ftp://example.invalid example.invalid')).toEqual([])
    expect(noteLinks('xhttps://example.invalid')).toEqual([])
  })
})
