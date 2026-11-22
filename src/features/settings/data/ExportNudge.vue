<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { downloadBackup } from './exportBackup'
import { snoozeNudge } from './exportReminder'
import { useExportNudge } from './useExportNudge'

const { t } = useI18n()
const planner = usePlannerStore()
const { nudge, text, refresh } = useExportNudge()

async function exportNow(): Promise<void> {
  if (!planner.document) return
  await downloadBackup(planner.document)
  refresh()
}

function later(): void {
  snoozeNudge(new Date())
  refresh()
}
</script>

<template>
  <section v-if="nudge" class="nudge" role="status" data-testid="export-nudge">
    <Icon name="download" :size="22" class="nudge-icon" />
    <p class="t-subhead nudge-text">{{ text }}</p>
    <div class="nudge-actions">
      <Button variant="tinted" @click="exportNow">{{ t('settings.exportNudge.action') }}</Button>
      <Button variant="plain" @click="later">{{ t('common.dismiss') }}</Button>
    </div>
  </section>
</template>

<style scoped>
.nudge { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: var(--space-2) var(--space-3); align-items: start; margin: 0 0 var(--section-gap); padding: var(--card-padding-block) var(--card-padding); background: var(--surface); border-radius: var(--radius-card); }
.nudge-icon { margin-top: 2px; color: var(--tint-label); }
.nudge-text { margin: 0; }
.nudge-actions { grid-column: 2; display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
