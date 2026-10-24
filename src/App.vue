<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import AppShell from '@/app/AppShell.vue'
import { listenForUpdates } from '@/app/updates'
import { isSupportedLocale, setLocale } from '@/i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import { installAppearance } from '@/ui/appearance'

const planner = usePlannerStore()
let stopUpdates = () => undefined as void

onMounted(() => {
  stopUpdates = listenForUpdates()
  void planner.start()
})
onBeforeUnmount(() => stopUpdates())

// Light or dark is chosen per device in Settings (index.html already applied it before the first paint).
installAppearance()

watch(() => planner.document?.settings.locale, (locale) => {
  if (isSupportedLocale(locale)) setLocale(locale)
}, { immediate: true })
</script>

<template>
  <AppShell />
</template>
