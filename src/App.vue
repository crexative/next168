<script setup lang="ts">
import { onBeforeUnmount, onMounted, watch } from 'vue'
import AppShell from '@/app/AppShell.vue'
import { listenForUpdates } from '@/app/updates'
import { isSupportedLocale, setLocale } from '@/i18n'
import { usePlannerStore } from '@/stores/plannerStore'

const planner = usePlannerStore()
let stopUpdates = () => undefined as void

onMounted(() => {
  stopUpdates = listenForUpdates()
  void planner.start()
})
onBeforeUnmount(() => stopUpdates())

watch(() => planner.document?.settings.theme, (theme = 'system') => {
  if (theme === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
}, { immediate: true })

watch(() => planner.document?.settings.locale, (locale) => {
  if (isSupportedLocale(locale)) setLocale(locale)
}, { immediate: true })
</script>

<template>
  <AppShell />
</template>
