<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { fenceFor, type StorageFence } from '@/repositories/storageVersion'

const props = defineProps<{ fence?: StorageFence }>()
const { t } = useI18n()
// The storage upgrade waits for an older version open in another tab to close its connection.
const fence = props.fence ?? fenceFor(globalThis.indexedDB)
const waiting = ref(fence.waiting())
const stop = fence.onWaiting((next) => { waiting.value = next })
onBeforeUnmount(stop)
</script>

<template>
  <p v-if="waiting" class="upgrade-waiting t-subhead" role="status" data-testid="storage-upgrade-waiting">{{ t('app.storage.upgradeWaiting') }}</p>
</template>

<style scoped>
.upgrade-waiting { margin: var(--space-3) var(--page-gutter); padding: var(--row-padding-block) var(--card-padding); border-radius: var(--radius-card); background: var(--surface); }
</style>
