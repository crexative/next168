<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { activePlannerRepository, usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import ListGroup from '@/ui/ListGroup.vue'
import { formatBytes } from '@/ui/format'
import { preUpgradeFiles, saveFile, type PreUpgradeFiles } from './preUpgradeCopy'

const { t, locale } = useI18n()
const planner = usePlannerStore()
const files = shallowRef<PreUpgradeFiles | null>(null)

// Read again when the planner is replaced: delete-all erases the copy.
watch(() => planner.document?.workspaceId, async () => {
  const copy = await activePlannerRepository().preUpgradeCopy?.().catch(() => undefined)
  files.value = copy ? await preUpgradeFiles(copy) : null
}, { immediate: true })

const date = computed(() => (files.value ? new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium' }).format(new Date(files.value.capturedAt)) : ''))
</script>

<template>
  <ListGroup v-if="files" :header="t('data.preUpgrade.title', { date })" :footer="t('data.preUpgrade.note')" data-testid="pre-upgrade-copy">
    <li class="note">
      <p v-if="files.bundle?.tooLarge" class="t-subhead" data-testid="pre-upgrade-too-large">{{ t('data.preUpgrade.tooLarge', { size: formatBytes(files.bundle.bytes, locale) }) }}</p>
      <p v-else-if="files.bundle" class="t-footnote t-secondary" data-testid="pre-upgrade-size">{{ t('data.preUpgrade.size', { size: formatBytes(files.bundle.bytes, locale) }) }}</p>
      <div class="actions">
        <Button v-if="files.bundle" variant="tinted" @click="saveFile(files.bundle)"><Icon name="download" :size="20" /> {{ t('data.preUpgrade.download') }}</Button>
        <Button variant="plain" @click="saveFile(files.raw)">{{ t('data.preUpgrade.downloadRaw') }}</Button>
      </div>
    </li>
  </ListGroup>
</template>

<style scoped>
.note { display: flex; flex-direction: column; gap: var(--space-2); padding: var(--row-padding-block) var(--card-padding); }
.actions { display: flex; flex-wrap: wrap; gap: var(--space-2); }
</style>
