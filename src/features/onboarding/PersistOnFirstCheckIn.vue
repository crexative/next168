<script setup lang="ts">
import { watch } from 'vue'
import { persistenceAlreadyRequested, requestPersistentStorage, shouldRequestPersistence } from '@/features/settings/data/storageProtection'
import { usePlannerStore } from '@/stores/plannerStore'

// Renders nothing. Once the planner holds a first check-in there is something worth protecting, so the browser
// is asked once to keep the storage (the first check-in belongs to another slice, which this only observes).
const planner = usePlannerStore()

watch(() => planner.document?.checkIns.length ?? 0, (checkIns) => {
  if (shouldRequestPersistence({ checkIns, requested: persistenceAlreadyRequested() })) void requestPersistentStorage()
}, { immediate: true })
</script>

<template><span hidden /></template>
