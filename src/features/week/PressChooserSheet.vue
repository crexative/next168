<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import Sheet from '@/ui/Sheet.vue'
import type { PressOption } from './pressOption'

// Where Week items crowd each other, one press target asks which of them to open: every item there, with its time and
// kind, each row a 44 px target. Picking one closes the chooser and opens that item.
defineProps<{ open: boolean; options: PressOption[] }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const { t } = useI18n()

function pick(option: PressOption): void {
  emit('update:open', false)
  option.activate()
}
</script>

<template>
  <Sheet :open="open" :title="t('week.chooser.title')" :dismiss-label="t('common.close')" @update:open="emit('update:open', $event)">
    <ul class="choices" data-testid="press-chooser">
      <li v-for="option in options" :key="option.key">
        <button type="button" class="choice" data-testid="press-choice" :data-choice-key="option.key" @click="pick(option)">
          <span class="choice-title t-body">{{ option.title }}</span>
          <span class="choice-detail t-footnote">{{ t(`week.chooser.kind.${option.kind}`) }}&nbsp;· {{ option.range }}</span>
        </button>
      </li>
    </ul>
  </Sheet>
</template>

<style scoped>
.choices { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.choice {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 2px;
  width: 100%;
  min-height: var(--tap-target);
  padding: var(--space-2) 0;
  border: 0;
  border-bottom: 0.5px solid var(--separator);
  background: transparent;
  color: var(--label);
  text-align: start;
  cursor: pointer;
}
.choice-title { font-weight: 600; overflow-wrap: break-word; }
.choice-detail { color: var(--label-2); }
</style>
