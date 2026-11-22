// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { defineComponent, h, nextTick } from 'vue'
import { mountWithPlanner, WORK, type Mounted } from '@/features/settings/testSupport'
import { FIRST_SEEN_KEY, recordExport } from './exportReminder'
import { noteExported, useExportNudge } from './useExportNudge'

let mounted: Mounted | undefined
afterEach(() => { mounted?.unmount(); mounted = undefined; localStorage.clear(); document.body.innerHTML = '' })

// Review of #64: an export from "Exportar copia" on the data page quiets the reminder at once, on the page and on the
// "Tus datos" row, as the notice's own button does.
it('any export quiets the reminder the row and the page share', async () => {
  localStorage.setItem(FIRST_SEEN_KEY, new Date(Date.now() - 30 * 86_400_000).toISOString())
  mounted = await mountWithPlanner(defineComponent({ setup: () => { const { text } = useExportNudge(); return () => h('p', { 'data-testid': 'note' }, text.value) } }), { categories: [WORK] })
  await nextTick()
  const note = () => mounted!.host.querySelector('[data-testid=note]')!.textContent
  expect(note()).not.toBe('')
  recordExport(new Date())
  noteExported()
  await nextTick()
  expect(note()).toBe('')
})
