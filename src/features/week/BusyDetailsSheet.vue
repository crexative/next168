<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Sheet from '@/ui/Sheet.vue'
import { formatDate } from './localTime'
import type { BusyDetails } from './busyDetails'

defineProps<{ open: boolean; details: BusyDetails | null }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const { t, locale } = useI18n()

</script>

<template>
  <Sheet :open="open" :title="details?.title ?? ''" @update:open="emit('update:open', $event)">
    <dl v-if="details" class="details" data-testid="busy-details">
      <div>
        <dt class="t-footnote">{{ t('week.details.when') }}</dt>
        <dd class="t-body">{{ formatDate(details.date, locale, { weekday: 'long', day: 'numeric', month: 'long' }) }}, {{ details.range }}</dd>
      </div>
      <div>
        <dt class="t-footnote">{{ t('week.details.calendar') }}</dt>
        <dd class="t-body">{{ details.calendar }}</dd>
      </div>
      <div v-for="title in details.conflictsWith" :key="title" class="conflict" data-testid="busy-details-conflict">
        <dd class="t-body">{{ t('week.details.conflictsWith', { title }) }}</dd>
      </div>
    </dl>
  </Sheet>
</template>

<style scoped>
.details { display: flex; flex-direction: column; gap: var(--space-3); }
dt { color: var(--label-2); }
dd { margin: 0; overflow-wrap: anywhere; }
.conflict dd { color: var(--danger-label); font-weight: 600; }
</style>
