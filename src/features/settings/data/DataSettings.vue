<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { STORAGE_KEYS } from '@/core/model'
import { createBrowserRepositories } from '@/repositories/browserRepositories'
import { assertDocumentHash, CHANGED_ELSEWHERE, documentHash } from '@/features/insights/entryGuard'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import Sheet from '@/ui/Sheet.vue'
import { calendarSourceStore } from './calendarSourceHook'
import { LAST_TASK_CATEGORY_KEY } from '@/features/tasks/lastCategory'
import { downloadBackup } from './exportBackup'
import { FIRST_SEEN_KEY, LAST_EXPORT_KEY, SNOOZED_KEY } from './exportReminder'
import { PERSIST_REQUESTED_KEY } from './storageProtection'
import {
  freshDocument, MAX_IMPORT_BYTES, matchesConfirmation, previewImport, replaceContent,
  replaceSourceTexts, verifyStored, type ImportPreview,
} from './dataTransfer'

// Everything this app keeps outside the document, so "delete all data" leaves nothing of the person behind.
const LEFTOVER_KEYS = [
  STORAGE_KEYS.backup, STORAGE_KEYS.legacyV1, STORAGE_KEYS.proposals, 'next168-tutorial-completed',
  LAST_EXPORT_KEY, FIRST_SEEN_KEY, SNOOZED_KEY, PERSIST_REQUESTED_KEY, LAST_TASK_CATEGORY_KEY,
]

type Notice = { tone: 'ok' | 'error'; text: string }

const { t } = useI18n()
const planner = usePlannerStore()

const fileInput = ref<HTMLInputElement | null>(null)
const preview = shallowRef<ImportPreview | null>(null)
const notice = ref<Notice | null>(null)
const busy = ref(false)
const deleteOpen = ref(false)
const typed = ref('')
// Canonical hash of the whole document the open import preview / delete confirmation was computed for;
// checked again inside the commit, whatever metadata the replacing content carries.
let previewHash: string | undefined
let deleteHash: string | undefined

function openDelete(): void {
  deleteHash = documentHash(planner.document)
  deleteOpen.value = true
}

function closeDelete(): void {
  deleteOpen.value = false
  deleteHash = undefined
  typed.value = ''
}

function closePreview(): void {
  preview.value = null
  previewHash = undefined
}

function refusedAsChanged(reason: string): string | null {
  return reason === CHANGED_ELSEWHERE ? t('data.changedElsewhere') : null
}

const phrase = computed(() => t('data.deleteAll.phrase'))
const canDelete = computed(() => planner.writable && matchesConfirmation(typed.value, phrase.value))
const countRows = computed(() => (preview.value ? (Object.entries(preview.value.counts) as [keyof ImportPreview['counts'], number][]).filter(([, count]) => count > 0) : []))

async function exportData(): Promise<void> {
  const document = planner.document
  if (!document) return
  try {
    const fileName = await downloadBackup(document)
    notice.value = { tone: 'ok', text: t('data.export.done', { fileName }) }
  } catch (failure) {
    notice.value = { tone: 'error', text: t('data.export.failed', { reason: failure instanceof Error ? failure.message : String(failure) }) }
  }
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  closePreview()
  notice.value = null
  const current = planner.document
  if (!file || !current) return
  if (file.size > MAX_IMPORT_BYTES) {
    notice.value = { tone: 'error', text: t('data.import.tooLarge') }
    return
  }
  const result = previewImport(await file.text(), current, new Date())
  if (result.kind === 'ok') { preview.value = result.preview; previewHash = documentHash(current) }
  else if (result.kind === 'unsupported') notice.value = { tone: 'error', text: t('data.import.unsupported', { version: String(result.version) }) }
  else notice.value = { tone: 'error', text: t('data.import.invalid', { reason: result.reason }) }
}

async function confirmImport(): Promise<void> {
  const chosen = preview.value
  if (!chosen) return
  busy.value = true
  const hash = previewHash
  const result = await planner.commit((draft) => { assertDocumentHash(draft, hash); replaceContent(draft, chosen.document) })
  if (!result.ok) {
    const changed = refusedAsChanged(result.reason)
    if (changed) { planner.dismissError(); closePreview() }
    notice.value = { tone: 'error', text: changed ?? t('data.import.failed', { reason: result.reason }) }
    busy.value = false
    return
  }
  await replaceSourceTexts(calendarSourceStore(), chosen.bundle.calendarSourceTexts)
  const verified = await verifyStored(chosen.bundle, () => createBrowserRepositories().planner.load(), calendarSourceStore())
  notice.value = verified.ok
    ? { tone: 'ok', text: t('data.import.verified', { hash: verified.hash.slice(0, 12) }) }
    : { tone: 'error', text: t(`data.import.verifyFailed.${verified.reason}`) }
  closePreview()
  busy.value = false
}

async function removeLeftovers(): Promise<void> {
  const purge = () => LEFTOVER_KEYS.forEach((key) => window.localStorage.removeItem(key))
  if (navigator.locks) await navigator.locks.request(STORAGE_KEYS.lockName, { mode: 'exclusive' }, purge)
  else purge()
}

async function deleteEverything(): Promise<void> {
  const current = planner.document
  const hash = deleteHash
  if (!current || !hash || !canDelete.value) return
  busy.value = true
  const fresh = freshDocument(current, new Date())
  const result = await planner.commit((draft) => { assertDocumentHash(draft, hash); replaceContent(draft, fresh) })
  if (result.ok) {
    await replaceSourceTexts(calendarSourceStore(), {})
    await removeLeftovers()
    closeDelete()
    closePreview()
    notice.value = { tone: 'ok', text: t('data.deleteAll.done') }
  } else {
    const changed = refusedAsChanged(result.reason)
    if (changed) { planner.dismissError(); closeDelete() }
    notice.value = { tone: 'error', text: changed ?? t('data.deleteAll.failed', { reason: result.reason }) }
  }
  busy.value = false
}
</script>

<template>
  <div v-if="planner.document" class="data">
    <ListGroup :header="t('data.title')" :footer="t('data.ios.body')">
      <li class="note actions">
        <Button @click="exportData"><Icon name="download" :size="20" /> {{ t('data.export.action') }}</Button>
        <Button variant="plain" :disabled="!planner.writable" @click="fileInput?.click()"><Icon name="upload" :size="20" /> {{ t('data.import.action') }}</Button>
        <input ref="fileInput" class="visually-hidden" type="file" accept=".json,application/json" :aria-label="t('data.import.fileLabel')" tabindex="-1" @change="onFileChosen">
      </li>
    </ListGroup>

    <section v-if="preview" class="preview" :aria-label="t('data.import.previewTitle')" data-testid="import-preview">
      <h2 class="t-headline">{{ t('data.import.previewTitle') }}</h2>
      <p class="t-subhead" data-testid="import-version">
        {{ t('data.import.version', { version: preview.sourceVersion, current: preview.document.schemaVersion }) }}
        <template v-if="preview.migratedFrom"> · {{ t('data.import.migrated', { from: preview.migratedFrom }) }}</template>
      </p>
      <ul class="counts">
        <li v-for="[key, count] in countRows" :key="key" class="t-subhead" :data-testid="`count-${key}`">{{ t(`data.import.counts.${key}`, { count }, count) }}</li>
      </ul>
      <p class="t-footnote t-secondary">{{ t('data.import.replaceWarning') }}</p>
      <div class="actions">
        <Button variant="plain" :disabled="busy" @click="closePreview">{{ t('common.cancel') }}</Button>
        <Button destructive :disabled="busy || !planner.writable" @click="confirmImport">{{ t('data.import.replace') }}</Button>
      </div>
    </section>

    <p v-if="notice" class="notice t-subhead" :class="`is-${notice.tone}`" :role="notice.tone === 'error' ? 'alert' : 'status'" data-testid="data-notice">{{ notice.text }}</p>

    <ListGroup :header="t('data.deleteAll.title')" :footer="t('data.deleteAll.footer')">
      <li class="note">
        <Button variant="plain" destructive :disabled="!planner.writable" @click="openDelete"><Icon name="trash-2" :size="20" /> {{ t('data.deleteAll.action') }}</Button>
      </li>
    </ListGroup>

    <Sheet :open="deleteOpen" :title="t('data.deleteAll.confirmTitle')" :dirty="typed !== ''" @update:open="(open) => { if (open) openDelete(); else closeDelete() }">
      <form class="confirm" @submit.prevent="deleteEverything">
        <p class="t-subhead">{{ t('data.deleteAll.confirmBody') }}</p>
        <label class="field">
          <span class="t-footnote t-secondary">{{ t('data.deleteAll.typeToConfirm', { phrase }) }}</span>
          <input v-model="typed" class="input" type="text" autocomplete="off" autocapitalize="off" spellcheck="false">
        </label>
        <Button type="submit" destructive block :disabled="!canDelete || busy">{{ t('data.deleteAll.confirmAction') }}</Button>
      </form>
    </Sheet>
  </div>
</template>

<style scoped>
.data { padding-inline: var(--space-4); }
.note { padding: var(--space-3) var(--space-4); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
.preview { display: flex; flex-direction: column; gap: var(--space-2); margin-block: var(--space-4); padding: var(--space-4); background: var(--surface); border-radius: var(--radius-card); }
.counts { display: flex; flex-wrap: wrap; gap: var(--space-1) var(--space-4); }
.notice { margin-block: var(--space-3); padding: var(--space-3) var(--space-4); border-radius: var(--radius-card); background: var(--surface); }
.notice.is-ok { border-inline-start: 4px solid var(--success); }
.notice.is-error { border-inline-start: 4px solid var(--danger); }
.confirm { display: flex; flex-direction: column; gap: var(--space-3); }
.field { display: flex; flex-direction: column; gap: var(--space-1); }
</style>
