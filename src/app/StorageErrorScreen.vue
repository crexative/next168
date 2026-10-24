<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import type { CalendarSourceStore } from '@/core/model'
import { calendarSourceStore } from '@/features/settings/data/calendarSourceHook'
import { buildExportFile } from '@/features/settings/data/dataTransfer'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import { usePlannerStore } from '@/stores/plannerStore'

const { t } = useI18n()
const planner = usePlannerStore()
const retrying = ref(false)
const missingCalendars = ref(false)

async function retry(): Promise<void> {
  retrying.value = true
  try { await planner.load() } finally { retrying.value = false }
}

// Exports the last committed document. A calendar text that cannot be read is exported empty, and the screen says so.
async function exportCopy(): Promise<void> {
  const document = planner.document
  if (!document) return
  const store = calendarSourceStore()
  missingCalendars.value = false
  const safeTexts: CalendarSourceStore | undefined = store && {
    get: async (id) => {
      try { return await store.get(id) } catch { missingCalendars.value = true; return undefined }
    },
    put: () => Promise.resolve(),
    delete: () => Promise.resolve(),
    list: () => Promise.resolve([]),
  }
  const { fileName, json } = await buildExportFile(document, safeTexts, { now: () => new Date() })
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const link = window.document.createElement('a')
  link.href = url
  link.download = fileName
  window.document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
</script>

<template>
  <section class="storage-error" data-testid="storage-error" role="alert">
    <EmptyState icon="triangle-alert" :title="t('app.storage.unavailableTitle')" :description="t('app.storage.unavailableBody')">
      <p v-if="planner.lastChangeLost" class="t-subhead" data-testid="last-change-not-saved">{{ t('app.storage.lastChangeNotSaved') }}</p>
      <p class="t-footnote t-secondary">{{ t('app.recovery.reason', { reason: planner.error }) }}</p>
      <p v-if="missingCalendars" class="t-footnote t-secondary">{{ t('app.storage.exportWithoutCalendars') }}</p>
      <div class="actions">
        <Button v-if="planner.document" variant="filled" @click="exportCopy">{{ t('app.storage.exportCopy') }}</Button>
        <Button :variant="planner.document ? 'tinted' : 'filled'" :disabled="retrying" @click="retry">{{ t('app.storage.retry') }}</Button>
      </div>
    </EmptyState>
  </section>
</template>

<style scoped>
.storage-error { padding-top: var(--space-8); }
.storage-error p { max-width: 28rem; margin-inline: auto; }
.actions { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); margin-top: var(--space-4); }
</style>
