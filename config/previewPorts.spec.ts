// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { previewPorts } from '../e2e/support/ports'

// storage-fence uses root + 2 and + 3, upgrade-from-production root + 4 and + 5: the server-mode build must not take any.
describe('previewPorts', () => {
  it('gives the server-mode build a port no other e2e server of the checkout uses', () => {
    const { root, subpath, server } = previewPorts('/some/checkout', undefined)
    const taken = [root, subpath, root + 2, root + 3, root + 4, root + 5]
    expect(taken).not.toContain(server)
    expect(server).toBe(root + 6)
  })

  it('keeps two checkouts from sharing any port of their range', () => {
    const range = (checkout: string) => { const { root } = previewPorts(checkout, undefined); return Array.from({ length: 8 }, (_, offset) => root + offset) }
    for (let index = 0; index < 50; index += 1) {
      const a = range(`/checkout/${index}`), b = range(`/checkout/${index + 1000}`)
      if (a[0] === b[0]) continue
      expect(a.filter((port) => b.includes(port))).toEqual([])
    }
  })

  it('PW_PORT_BASE moves all of them together', () => {
    expect(previewPorts('/x', '30000')).toEqual({ root: 30000, subpath: 30001, server: 30006 })
    expect(() => previewPorts('/x', '65529')).toThrow(/PW_PORT_BASE/)
  })
})
