import { beforeEach, describe, it, expect, vi } from 'vitest'
import { AgendaRepository, AGENDA_KEY, ROUTINE_KEY, decodeBackup } from './AgendaRepository'
import { LocalStorageRepository } from './LocalStorageRepository'
import { emptyAgenda } from '@/services/AgendaService'
import { item } from '@/fixtures/agenda'
const routine = { categories: [{ id: 'category', name: 'Synthetic', color: '#123456', weeklyHourLimit: 20 }], timeBlocks: [] }
beforeEach(() => { localStorage.clear(); vi.restoreAllMocks() })
describe('durable local data', () => {
  it('loads legacy routine without migration loss and rejects corrupt storage', async () => {
    localStorage.setItem(ROUTINE_KEY, JSON.stringify(routine))
    const repo = new LocalStorageRepository(ROUTINE_KEY)
    expect(await repo.load()).toEqual(routine)
    expect(await repo.save(routine)).toBe(true)
    expect(localStorage.getItem(`${ROUTINE_KEY}-backup`)).toBe(JSON.stringify(routine))
    localStorage.setItem(ROUTINE_KEY, '{broken')
    await expect(repo.load()).rejects.toThrow('preserved')
    expect(await repo.save(routine)).toBe(false)
    expect(localStorage.getItem(ROUTINE_KEY)).toBe('{broken')
  })
  it('round trips agenda IDs, dates and status across repository instances with recovery copy', () => {
    const repo = new AgendaRepository(); const data = repo.load()
    const saved = repo.save({ ...data, items: [item({ kind: 'reservation', status: 'reserved' })] })
    expect(new AgendaRepository().load()).toEqual(saved)
    repo.save({ ...saved, workEnd: '17:30' })
    expect(JSON.parse(localStorage.getItem(`${AGENDA_KEY}-backup`)!)).toEqual(saved)
  })
  it('fails quota writes without changing the durable primary', () => {
    const repo = new AgendaRepository(); const old = repo.save(repo.load())
    const raw = localStorage.getItem(AGENDA_KEY)
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota') })
    expect(() => repo.save({ ...old, items: [item()] })).toThrow('quota')
    expect(localStorage.getItem(AGENDA_KEY)).toBe(raw)
  })
  it('rejects stale tabs instead of overwriting concurrent changes', () => {
    const first = new AgendaRepository(), second = new AgendaRepository()
    const a = first.load(), b = second.load()
    first.save({ ...a, items: [item()] })
    expect(() => second.save(b)).toThrow('another tab')
  })
  it('validates full backup before replacement and restores routine and agenda', () => {
    const repo = new AgendaRepository(); repo.load()
    const backup = decodeBackup({ schemaVersion: 1, routine, agenda: { ...emptyAgenda(), items: [item()] } })
    repo.restore(backup)
    expect(new AgendaRepository().load().items).toEqual(backup.agenda.items)
    expect(JSON.parse(localStorage.getItem(ROUTINE_KEY)!)).toEqual(routine)
    const raw = localStorage.getItem(AGENDA_KEY)
    expect(() => repo.restore({ ...backup, schemaVersion: 2 } as unknown as typeof backup)).toThrow()
    expect(localStorage.getItem(AGENDA_KEY)).toBe(raw)
  })
  it('rolls back both primaries when the second restore write fails', () => {
    const repo = new AgendaRepository(); repo.save(repo.load())
    localStorage.setItem(ROUTINE_KEY, JSON.stringify(routine))
    const before = [localStorage.getItem(AGENDA_KEY), localStorage.getItem(ROUTINE_KEY)]
    const original = localStorage.setItem.bind(localStorage)
    let once = false
    vi.spyOn(localStorage, 'setItem').mockImplementation(function (this: Storage, key, value) {
      if (key === ROUTINE_KEY && !once) { once = true; throw new Error('quota') }
      return original.call(this, key, value)
    })
    expect(() => repo.restore({ schemaVersion: 1, routine, agenda: { ...emptyAgenda(), items: [item()] } })).toThrow('quota')
    expect([localStorage.getItem(AGENDA_KEY), localStorage.getItem(ROUTINE_KEY)]).toEqual(before)
  })
})
