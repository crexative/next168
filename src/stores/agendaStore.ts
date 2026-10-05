import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { AgendaData, AgendaItem } from '@/types/agenda'
import { AgendaRepository, decodeBackup } from '@/repositories/AgendaRepository'
import { emptyAgenda, previewMoves, validateAgenda } from '@/services/AgendaService'
import { calendarPreview, eventFingerprint } from '@/services/CalendarExportService'

export const useAgendaStore = defineStore('agenda', () => {
  const repository = new AgendaRepository()
  const data = ref<AgendaData>(emptyAgenda())
  const error = ref('')
  const blocked = ref(false)
  function load() {
    try { data.value = repository.load(); blocked.value = false; error.value = '' }
    catch { blocked.value = true; error.value = 'Agenda could not be read. Original storage is preserved. Restore a valid backup.' }
  }
  function commit(next: AgendaData): boolean {
    if (blocked.value) return false
    try { data.value = repository.save(validateAgenda(next)); error.value = ''; return true }
    catch (cause) { error.value = cause instanceof Error ? cause.message : 'Save failed'; return false }
  }
  function put(item: AgendaItem): boolean {
    const items = data.value.items.filter(existing => existing.id !== item.id)
    return commit({ ...data.value, items: [...items, item] })
  }
  function applyProposal(proposal: unknown): boolean {
    try { return commit(previewMoves(data.value, proposal)) }
    catch (cause) { error.value = cause instanceof Error ? cause.message : 'Invalid proposal'; return false }
  }
  function markExported(): boolean {
    const exports = { ...data.value.exports }
    for (const item of calendarPreview(data.value)) exports[item.id] = eventFingerprint(item)
    return commit({ ...data.value, exports })
  }
  function restore(input: unknown): boolean {
    try { data.value = repository.restore(decodeBackup(input)); blocked.value = false; error.value = ''; return true }
    catch (cause) { error.value = cause instanceof Error ? cause.message : 'Restore failed'; if (error.value.includes('rollback')) blocked.value = true; return false }
  }
  load()
  return { data, error, blocked, load, put, applyProposal, commit, markExported, restore }
})
