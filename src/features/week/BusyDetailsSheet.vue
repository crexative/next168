<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Sheet from '@/ui/Sheet.vue'
import { formatDate } from './localTime'
import type { BusyDetails } from './busyDetails'

defineProps<{ open: boolean; details: BusyDetails | null; editable: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean]; select: [blockId: string] }>()

const { t, locale } = useI18n()

</script>

<template>
  <!-- The sheet only shows facts: its button closes it ("Close"), there is nothing to cancel. -->
  <Sheet :open="open" :title="details?.title ?? ''" :dismiss-label="t('common.close')" @update:open="emit('update:open', $event)">
    <dl v-if="details" class="details" data-testid="busy-details">
      <div>
        <dt class="t-footnote">{{ t('week.details.when') }}</dt>
        <dd class="t-body">{{ formatDate(details.date, locale, { weekday: 'long', day: 'numeric', month: 'long' }) }}, {{ details.range }}</dd>
      </div>
      <div v-if="details.location" data-testid="busy-details-location">
        <dt class="t-footnote">{{ t('week.details.location') }}</dt>
        <dd class="t-body">{{ details.location }}</dd>
      </div>
      <div>
        <dt class="t-footnote">{{ t('week.details.calendar') }}</dt>
        <dd class="t-body">{{ details.calendar }}</dd>
      </div>
      <div v-if="details.notes" data-testid="busy-details-notes">
        <dt class="t-footnote">{{ t('week.details.notes') }}</dt>
        <dd class="t-body notes">{{ details.notes }}</dd>
      </div>
      <div v-for="block in details.conflictsWith" :key="block.blockId" class="conflict" data-testid="busy-details-conflict">
        <dd><button type="button" class="conflict-button t-body" :disabled="!editable" @click="emit('select', block.blockId)">{{ t('week.details.conflictsWith', { title: block.title }) }}</button></dd>
      </div>
    </dl>
  </Sheet>
</template>

<style scoped>
.details { display: flex; flex-direction: column; gap: var(--space-3); }
dt { color: var(--label-2); }
/* Whole words: a line breaks between words, and only a word longer than the line (an address, a link) is broken. */
dd { margin: 0; overflow-wrap: break-word; }
.notes { white-space: pre-line; }
.conflict-button {
  display: block;
  width: 100%;
  min-height: var(--tap-target);
  padding: var(--space-1) 0;
  border: 0;
  background: transparent;
  color: var(--danger-label);
  font-weight: 600;
  text-align: start;
  cursor: pointer;
}
.conflict-button:disabled { cursor: default; }
</style>
