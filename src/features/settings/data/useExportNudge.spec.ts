// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mountWithPlanner, WORK, type Mounted } from '@/features/settings/testSupport'
import { downloadBackup } from './exportBackup'
import { FIRST_SEEN_KEY } from './exportReminder'
import { useExportNudge } from './useExportNudge'

let mounted: Mounted | undefined
afterEach(() => { mounted?.unmount(); mounted = undefined; localStorage.clear(); document.body.innerHTML = ''; vi.restoreAllMocks() })

// Review of #64: an export from "Exportar copia" on the data page quiets the reminder at once, on the page and on the
// "Tus datos" row, as the notice's own button does.
it('any export quiets the reminder the row and the page share', async () => {
  localStorage.setItem(FIRST_SEEN_KEY, new Date(Date.now() - 30 * 86_400_000).toISOString())
  mounted = await mountWithPlanner(defineComponent({ setup: () => { const { text } = useExportNudge(); return () => h('p', { 'data-testid': 'note' }, text.value) } }), { categories: [WORK] })
  await nextTick()
  const note = () => mounted!.host.querySelector('[data-testid=note]')!.textContent
  expect(note()).not.toBe('')
  // The export the data page runs ("Exportar copia"), not the reminder's own bookkeeping.
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:backup')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  await downloadBackup(mounted.store.document!)
  await nextTick()
  expect(note()).toBe('')
})
