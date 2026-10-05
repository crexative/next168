import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import FlexibleAgenda from './FlexibleAgenda.vue'
import { i18n } from '@/i18n'
import { useAgendaStore } from '@/stores/agendaStore'
import { useWeekStore } from '@/stores/weekStore'
import { item } from '@/fixtures/agenda'
import { emptyAgenda, moveProposal } from '@/services/AgendaService'
import { AGENDA_KEY, ROUTINE_KEY } from '@/repositories/AgendaRepository'
let app: App
let host: HTMLDivElement
async function settle() { await Promise.resolve(); await nextTick(); await Promise.resolve(); await nextTick() }
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find(button => button.textContent?.includes(text))
  if (!found) throw new Error(`Missing button ${text}`)
  return found
}
async function input(selector: string, value: string) {
  const element = host.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!
  element.value = value; element.dispatchEvent(new Event('input', { bubbles: true })); await settle()
}
beforeEach(async () => {
  localStorage.clear(); vi.restoreAllMocks(); i18n.global.locale.value = 'en'
  const pinia = createPinia(); setActivePinia(pinia)
  host = document.createElement('div'); document.body.append(host)
  app = createApp(FlexibleAgenda); app.use(pinia); app.use(i18n); app.mount(host); await settle()
})
afterEach(() => { app.unmount(); host.remove() })
describe('rendered planning interface', () => {
  it('creates, edits and completes a dated task without duplicating its ID', async () => {
    await input('form input[maxlength]', 'Synthetic pending')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle()
    const store = useAgendaStore(); const id = store.data.items[0]!.id
    expect(host.querySelector('article')?.textContent).toContain('Synthetic pending')
    button('Edit / reschedule').click(); await settle()
    await input('form input[type=date]', '2026-10-06')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle()
    expect(store.data.items).toHaveLength(1); expect(store.data.items[0]?.id).toBe(id)
    button('Edit / reschedule').click(); await settle()
    const select = host.querySelectorAll<HTMLSelectElement>('form select')[1]!
    select.value = 'done'; select.dispatchEvent(new Event('change', { bubbles: true }))
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle()
    expect(host.querySelector('article')?.textContent).toContain('Done')
    store.load(); expect(store.data.items[0]?.status).toBe('done')
  })
  it('reviews a local assistant proposal before applying and rejects stale review', async () => {
    const store = useAgendaStore(); store.put(item()); await settle()
    button('Try a local proposal').click(); await settle()
    expect(store.data.items[0]?.date).toBe('2026-10-05')
    expect(host.textContent).toContain('External calendar availability is unknown')
    button('Apply reviewed').click(); await settle()
    expect(store.data.items[0]?.date).toBe('2026-10-06')
    const proposal = moveProposal(store.data, { id: 'task-1', date: '2026-10-07', startTime: '18:00', endTime: '19:00' })
    await input('#assistant-proposal', JSON.stringify(proposal)); button('Review proposal').click(); await settle()
    store.put(item({ id: 'meeting', date: '2026-10-08', kind: 'meeting' })); await settle()
    button('Apply reviewed').click(); await settle()
    expect(store.data.items.find(item => item.id === 'task-1')?.date).toBe('2026-10-06')
    expect(host.querySelector('[role=alert]')?.textContent).toContain('stale')
  })
  it('copies routine only once for a chosen date and preserves the routine', async () => {
    const week = useWeekStore()
    expect(week.addTimeBlock({ categoryId: week.categories[0]!.id, title: 'Synthetic routine', dayOfWeek: 1, startTime: '18:00', endTime: '19:00' }).success).toBe(true)
    await input('.controls input[type=date]', '2026-10-05')
    button('Use the routine').click(); await settle(); button('Use the routine').click(); await settle()
    expect(useAgendaStore().data.items).toHaveLength(1)
    expect(useAgendaStore().data.items[0]?.calendarSelected).toBe(false)
    expect(week.timeBlocks).toHaveLength(1)
  })
  it('adjusts dinner and disconnection for one date without altering the routine series', async () => {
    const week = useWeekStore()
    week.addTimeBlock({ categoryId: week.categories[0]!.id, title: 'Synthetic dinner', dayOfWeek: 1, repeatDays: [2], startTime: '18:00', endTime: '19:00' })
    week.addTimeBlock({ categoryId: week.categories[0]!.id, title: 'Synthetic disconnection', dayOfWeek: 1, repeatDays: [2], startTime: '19:00', endTime: '20:00' })
    await input('.controls input[type=date]', '2026-10-05'); button('Use the routine').click(); await settle()
    await input('.controls input[type=date]', '2026-10-06'); button('Use the routine').click(); await settle()
    const store = useAgendaStore(); const monday = store.data.items.filter(item => item.date === '2026-10-05')
    expect(store.applyProposal({ schemaVersion: 1, baseRevision: store.data.revision, moves: monday.map(item => ({ id: item.id, date: item.date, startTime: item.title.includes('dinner') ? '20:00' : '21:00', endTime: item.title.includes('dinner') ? '21:00' : '22:00' })) })).toBe(true)
    expect(store.data.items.filter(item => item.date === '2026-10-06').map(item => item.startTime)).toEqual(['18:00', '19:00'])
    expect(week.timeBlocks.map(block => block.startTime)).toEqual(['18:00', '19:00'])
  })
  it('downloads only chosen meetings and suppresses unchanged repeats locally', async () => {
    const store = useAgendaStore()
    store.put(item({ kind: 'meeting', calendarSelected: true, title: 'Synthetic selected meeting' }))
    store.put(item({ id: 'task-2', startTime: '20:00', endTime: '21:00' }))
    const url = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:synthetic')
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    await settle(); button('Download chosen').click(); await settle()
    expect(click).toHaveBeenCalledTimes(1); expect(url).toHaveBeenCalledTimes(1)
    expect(button('Download chosen').disabled).toBe(true)
    expect(Object.keys(store.data.exports)).toEqual(['task-1'])
    expect(host.textContent).toContain('no event was sent to Calendar')
  })
  it('never replaces unreadable routine or agenda with sample data', async () => {
    localStorage.setItem(ROUTINE_KEY, '{broken'); localStorage.setItem(AGENDA_KEY, '{broken')
    await useWeekStore().loadFromStorage(); useAgendaStore().load(); await settle()
    expect(button('Save item').disabled).toBe(true)
    expect(useWeekStore().addCategory({ name: 'Synthetic', color: '#123456', weeklyHourLimit: 1 }).success).toBe(false)
    expect(localStorage.getItem(ROUTINE_KEY)).toBe('{broken'); expect(localStorage.getItem(AGENDA_KEY)).toBe('{broken')
  })
  it('shows quota failure without applying agenda changes or claiming saved', async () => {
    const store = useAgendaStore(); const initial = JSON.stringify(store.data)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await input('form input[maxlength]', 'Synthetic quota failure')
    host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await settle()
    expect(JSON.stringify(store.data)).toBe(initial)
    expect(host.querySelector('[role=alert]')?.textContent).toContain('quota')
    expect(host.querySelector('[role=status]')).toBeNull()
  })
  it('requires backup preview and explicit replacement choice', async () => {
    const content = { schemaVersion: 1, agenda: { ...emptyAgenda(), items: [item({ kind: 'reservation', status: 'reserved' })] }, routine: { categories: [], timeBlocks: [] } }
    const file = new File([JSON.stringify(content)], 'synthetic-backup.json', { type: 'application/json' })
    vi.spyOn(file, 'text').mockResolvedValue(JSON.stringify(content))
    const upload = host.querySelector<HTMLInputElement>('input[type=file]')!
    Object.defineProperty(upload, 'files', { value: [file] }); upload.dispatchEvent(new Event('change')); await settle()
    expect(button('Restore reviewed').disabled).toBe(true)
    expect(useAgendaStore().data.items).toHaveLength(0)
    const check = host.querySelector<HTMLInputElement>('details:last-child input[type=checkbox]')!
    check.click(); await settle(); button('Restore reviewed').click(); await settle()
    expect(useAgendaStore().data.items[0]?.status).toBe('reserved')
    expect(host.textContent).toContain('Backup restored')
  })
})
