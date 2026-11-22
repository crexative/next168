import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import { exportNudge, noteFirstVisit, readNudgeInput, type Nudge } from './exportReminder'

// The reminder to export a copy, shared by the "Tus datos" row (one amber line, R_Ajustes) and the notice with its
// actions on the "Tus datos" page. Re-read after each action: the stored times are not reactive. One value for every
// user: the row and the page live in the same view, so an export on the page must quiet the row too.
const nudge = ref<Nudge | null>(null)
// Every backup export, whichever button made it (the notice's or "Exportar copia" on the page): the reminder re-reads.
const exports = ref(0)
export function noteExported(): void {
  exports.value += 1
}

export function useExportNudge() {
  const { t } = useI18n()
  const planner = usePlannerStore()

  function refresh(): void {
    const document = planner.document
    const hasContent = !!document && (document.categories.length + document.blocks.length + document.tasks.length + document.checkIns.length) > 0
    nudge.value = exportNudge(readNudgeInput(new Date(), hasContent))
  }

  onMounted(() => noteFirstVisit(new Date()))
  // The document loads after the screen mounts, and what is worth saving depends on it.
  watch([() => planner.document, exports], refresh, { immediate: true })

  const text = computed(() => (!nudge.value ? '' : nudge.value.kind === 'overdue' ? t('settings.exportNudge.overdue', { days: nudge.value.days }) : t('settings.exportNudge.never')))
  return { nudge, text, refresh }
}
