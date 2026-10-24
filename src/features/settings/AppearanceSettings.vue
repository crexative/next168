<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import ListGroup from '@/ui/ListGroup.vue'
import SegmentedControl from '@/ui/SegmentedControl.vue'
import { appearance, setAppearance, type Appearance } from '@/ui/appearance'

// Light, dark or the system's choice, for this device.
const { t } = useI18n()
const options = computed(() => [
  { value: 'auto' as Appearance, label: t('settings.appearance.auto') },
  { value: 'light' as Appearance, label: t('settings.appearance.light') },
  { value: 'dark' as Appearance, label: t('settings.appearance.dark') },
])
</script>

<template>
  <div class="appearance" data-testid="appearance-settings">
    <ListGroup :header="t('settings.appearance.title')" :footer="t('settings.appearance.footer')">
      <li class="choice">
        <SegmentedControl :model-value="appearance" :options="options" :label="t('settings.appearance.title')" @update:model-value="setAppearance" />
      </li>
    </ListGroup>
  </div>
</template>

<style scoped>
.appearance { padding-inline: var(--space-4); }
.choice { padding: var(--space-2) var(--space-4); }
</style>
