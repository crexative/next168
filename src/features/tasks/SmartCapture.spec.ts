// @vitest-environment happy-dom
// Tasks P1-9 (the single-line box) and P1-10 (a multi-line paste), design rev 2.1 §7.3, rev 6 §2.1, addendum 6.1 F6.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { h, nextTick } from 'vue'
import { mountWithPlanner, type Mounted } from '@/features/settings/testSupport'
import { testDocument } from '@/repositories/testSupport'
import { useUndoToast } from '@/ui/undoToast'
import SmartCapture from './SmartCapture.vue'

// Mon 2026-10-26 08:02 in Bogotá.
const NOW = new Date('2026-10-26T13:02:00.000Z')
const settings = { ...testDocument().settings, onboardingDone: true, timeZone: 'America/Bogota', locale: 'es' }
let mounted: Mounted | undefined
beforeEach(() => { localStorage.clear(); vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW) })
afterEach(() => { mounted?.unmount(); mounted = undefined; useUndoToast().dismiss(); vi.useRealTimers(); document.body.innerHTML = '' })

async function mount(locale = 'es') {
  mounted = await mountWithPlanner(SmartCapture, { settings: { ...settings, locale } }, locale)
  return mounted
}
const host = () => mounted!.host
const field = () => host().querySelector<HTMLTextAreaElement>('textarea')!
const byTestId = <T extends Element = HTMLElement>(id: string) => [...host().querySelectorAll<T>(`[data-testid=${id}]`)]
const tasks = () => mounted!.store.document!.tasks

async function settle(): Promise<void> {
  for (let turn = 0; turn < 12; turn++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await mounted!.store.settled()
  }
  await nextTick()
}
async function type(text: string): Promise<void> {
  field().value = text
  field().dispatchEvent(new Event('input'))
  await nextTick()
  await settle()
}
async function enter(init: KeyboardEventInit = {}): Promise<void> {
  field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...init }))
  await settle()
}
// Dates and times keep their words together with no-break spaces; the assertions read plain spaces.
const chipLabels = () => byTestId('capture-chip-edit').map((chip) => chip.textContent?.trim().replace(/[\u00a0\u202f]/g, ' '))

describe('P1-9: one line', () => {
  it('«Llamar a mamá el jueves 20 min»: two chips, and Enter adds exactly one task with them', async () => {
    await mount()
    await type('Llamar a mamá el jueves 20 min')
    expect(chipLabels()).toEqual(['jue, 29 oct', '20 min'])
    await enter()
    expect(tasks()).toHaveLength(1)
    expect(tasks()[0]).toMatchObject({ title: 'Llamar a mamá', dueDate: '2026-10-29', durationMin: 20 })
    expect(field().value).toBe('')
  })

  it('✕ gives the words back to the title, and the chip does not come back while typing on', async () => {
    await mount()
    await type('dentista mañana 9am')
    expect(byTestId('capture-chip')).toHaveLength(2)
    const dateChip = byTestId('capture-chip').find((chip) => chip.dataset.field === 'date')!
    dateChip.querySelector<HTMLButtonElement>('[data-testid=capture-chip-remove]')!.click()
    await nextTick()
    expect(byTestId('capture-chip').map((chip) => chip.dataset.field)).toEqual(['time'])
    // The time alone resolves to today while 9:00 is ahead, and the chip says so.
    expect(chipLabels()).toEqual(['Hoy, 9:00'])
    await type('dentista mañana 9am ya')
    expect(byTestId('capture-chip').map((chip) => chip.dataset.field)).toEqual(['time'])
    await enter()
    expect(tasks()[0]).toMatchObject({ title: 'Dentista mañana ya', dueDate: '2026-10-26', at: 540 })
  })

  it('✎ changes a chip with its own control, and focus returns to the chip', async () => {
    await mount()
    await type('trotar hoy 1 h')
    const durationChip = byTestId('capture-chip').find((chip) => chip.dataset.field === 'duration')!
    const edit = durationChip.querySelector<HTMLButtonElement>('[data-testid=capture-chip-edit]')!
    edit.click()
    await nextTick()
    const editor = byTestId('capture-chip-editor')[0]!.querySelector<HTMLInputElement>('input')!
    editor.value = '45'
    editor.dispatchEvent(new Event('change'))
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await nextTick()
    await nextTick()
    expect(byTestId('capture-chip-editor')).toHaveLength(0)
    expect(document.activeElement).toBe(byTestId('capture-chip').find((chip) => chip.dataset.field === 'duration')!.querySelector('[data-testid=capture-chip-edit]'))
    await enter()
    expect(tasks()[0]).toMatchObject({ title: 'Trotar', dueDate: '2026-10-26', durationMin: 45 })
  })

  it('a control the person sets wins over the words: they go back to the title', async () => {
    await mount()
    await type('trotar mañana')
    byTestId<HTMLButtonElement>('task-today')[0]!.click()
    await nextTick()
    expect(byTestId('capture-chip')).toHaveLength(0)
    await enter()
    expect(tasks()[0]).toMatchObject({ title: 'Trotar mañana', dueDate: '2026-10-26' })
  })

  it('Enter during IME composition never submits', async () => {
    await mount()
    await type('llamar')
    await enter({ isComposing: true })
    await enter({ keyCode: 229 })
    field().dispatchEvent(new CompositionEvent('compositionstart'))
    await enter()
    expect(tasks()).toHaveLength(0)
    field().dispatchEvent(new CompositionEvent('compositionend'))
    await enter()
    expect(tasks()).toHaveLength(1)
  })

  it('one line among blank lines (CRLF, CR, U+2028, U+2029) is still one line with its chips', async () => {
    await mount()
    await type('\r\n  pagar luz el 5 \r  \n')
    expect(byTestId('capture-preview')).toHaveLength(0)
    expect(chipLabels()).toEqual(['jue, 5 nov'])
  })
})

describe('P1-10: a multi-line paste', () => {
  const FIVE = 'Llamar a mamá mañana\nPagar luz el 5\n- comprar pan\n  no olvidar la reunión de las 9am\nRevisar «el lunes» de Cortázar'

  it('offers one title-only task per line, infers nothing, and Enter never submits', async () => {
    await mount()
    await type(FIVE)
    expect(byTestId('capture-chip')).toHaveLength(0)
    expect(byTestId<HTMLInputElement>('capture-row-title').map((row) => row.value)).toEqual([
      'Llamar a mamá mañana', 'Pagar luz el 5', '- comprar pan', 'no olvidar la reunión de las 9am', 'Revisar «el lunes» de Cortázar',
    ])
    expect(byTestId('capture-add-all')[0]!.textContent?.trim()).toBe('Añadir como 5 tareas')
    expect(byTestId('capture-keep-one')[0]!.textContent?.trim()).toBe('Dejar como una tarea')
    await enter()
    expect(tasks()).toHaveLength(0)
    byTestId<HTMLButtonElement>('capture-add-all')[0]!.click()
    await settle()
    expect(tasks().map((task) => task.title)).toEqual(['Llamar a mamá mañana', 'Pagar luz el 5', '- comprar pan', 'no olvidar la reunión de las 9am', 'Revisar «el lunes» de Cortázar'])
    for (const task of tasks()) expect(Object.keys(task).sort()).toEqual(['createdAt', 'id', 'priority', 'title'])
  })

  it('rows can be edited and unchecked; Undo removes exactly those', async () => {
    await mount()
    await type(FIVE)
    const titles = byTestId<HTMLInputElement>('capture-row-title')
    titles[0]!.value = 'Llamar a mamá'
    titles[0]!.dispatchEvent(new Event('input'))
    const checks = [...host().querySelectorAll<HTMLInputElement>('[data-testid=capture-row] input[type=checkbox]')]
    checks[2]!.click()
    await nextTick()
    expect(byTestId('capture-add-all')[0]!.textContent?.trim()).toBe('Añadir como 4 tareas')
    byTestId<HTMLButtonElement>('capture-add-all')[0]!.click()
    await settle()
    expect(tasks().map((task) => task.title)).toEqual(['Llamar a mamá', 'Pagar luz el 5', 'no olvidar la reunión de las 9am', 'Revisar «el lunes» de Cortázar'])
    useUndoToast().undo()
    await settle()
    expect(tasks()).toEqual([])
  })

  it('«Dejar como una tarea» joins the lines with «; » into the one-line box', async () => {
    await mount()
    await type('Comprar pan\r\nLeche')
    byTestId<HTMLButtonElement>('capture-keep-one')[0]!.click()
    await nextTick()
    expect(field().value).toBe('Comprar pan; Leche')
    expect(byTestId('capture-preview')).toHaveLength(0)
  })

  it('a 121-character line is refused; five 31-character lines are too long as one task, and nothing is cut', async () => {
    await mount()
    const long = 'x'.repeat(121)
    await type(`Corta\n${long}`)
    const rows = byTestId('capture-row')
    expect(rows[1]!.querySelector<HTMLInputElement>('input[type=checkbox]')!.disabled).toBe(true)
    expect(rows[1]!.textContent).toContain('Esta línea es demasiado larga')
    expect(byTestId('capture-add-all')[0]!.textContent?.trim()).toBe('Añadir como 1 tarea')

    const five = Array.from({ length: 5 }, (_, index) => `${index}`.padEnd(31, 'y')).join('\n')
    await type(five)
    expect(byTestId<HTMLButtonElement>('capture-keep-one')[0]!.disabled).toBe(true)
    expect(byTestId('capture-keep-one-too-long')[0]!.textContent).toContain('Demasiado largo para una sola tarea')
    byTestId<HTMLButtonElement>('capture-keep-one')[0]!.click()
    await nextTick()
    expect(field().value).toBe(five)
  })

  it('21 lines offer «Usar con tu IA» instead of a list', async () => {
    await mount()
    await type(Array.from({ length: 21 }, (_, index) => `Tarea ${index + 1}`).join('\n'))
    expect(byTestId('capture-add-all')).toHaveLength(0)
    expect(byTestId('capture-row')).toHaveLength(0)
    expect(byTestId<HTMLAnchorElement>('capture-use-ai')[0]!.getAttribute('href')).toBe('#/assistant')
    expect(byTestId('capture-keep-one')).toHaveLength(1)
  })
})

describe('Today\'s add row', () => {
  it('a task with no date of its own is due today; a typed date still wins', async () => {
    mounted = await mountWithPlanner({ render: () => h(SmartCapture, { dueToday: true }) }, { settings }, 'es')
    await type('llamar a mamá')
    await enter()
    await type('dentista mañana 9am')
    await enter()
    expect(tasks().map((task) => [task.title, task.dueDate, task.at])).toEqual([['Llamar a mamá', '2026-10-26', undefined], ['Dentista', '2026-10-27', 540]])
  })
})
