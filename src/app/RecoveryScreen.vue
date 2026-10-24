<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import EmptyState from '@/ui/EmptyState.vue'
import Sheet from '@/ui/Sheet.vue'
import { usePlannerStore } from '@/stores/plannerStore'

const { t } = useI18n()
const planner = usePlannerStore()
const confirming = ref(false)

function downloadRaw(): void {
  const url = URL.createObjectURL(new Blob([planner.corruptRaw ?? ''], { type: 'text/plain' }))
  const link = document.createElement('a')
  link.href = url
  link.download = 'next168-unreadable-data.txt'
  link.click()
  URL.revokeObjectURL(url)
}

async function startFresh(): Promise<void> {
  await planner.startFresh()
  confirming.value = false
}
</script>

<template>
  <section class="recovery" data-testid="recovery">
    <EmptyState icon="triangle-alert" :title="t('app.recovery.title')" :description="t('app.recovery.description')">
      <p class="t-footnote t-secondary">{{ t('app.recovery.reason', { reason: planner.corruptReason }) }}</p>
      <div class="actions">
        <Button variant="filled" @click="downloadRaw">{{ t('app.recovery.export') }}</Button>
        <Button v-if="planner.backupAvailable" variant="tinted" @click="planner.restoreBackup()">{{ t('app.recovery.restoreBackup') }}</Button>
        <Button variant="plain" destructive @click="confirming = true">{{ t('app.recovery.startFresh') }}</Button>
      </div>
    </EmptyState>
    <Sheet v-model:open="confirming" :title="t('app.recovery.confirmTitle')" no-dismiss>
      <p class="t-body">{{ t('app.recovery.confirmBody') }}</p>
      <div class="actions">
        <Button variant="filled" destructive block @click="startFresh">{{ t('app.recovery.confirmAction') }}</Button>
        <Button variant="plain" block @click="confirming = false">{{ t('common.cancel') }}</Button>
      </div>
    </Sheet>
  </section>
</template>

<style scoped>
.recovery { padding-top: var(--space-8); }
.actions { display: flex; flex-direction: column; align-items: stretch; gap: var(--space-2); margin-top: var(--space-4); }
</style>
