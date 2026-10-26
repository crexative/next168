<script setup lang="ts">
// Weeklid's symbol, in the current appearance's brand colours. Its accessible name is the app's name.
import { i18n } from '@/i18n'
import { SYMBOL_SQUARE_VIEW_BOX, SYMBOL_STROKE_WIDTH, SYMBOL_TICK, SYMBOL_W } from './brandMark'

withDefaults(defineProps<{ size?: number }>(), { size: 32 })
</script>

<template>
  <svg class="app-mark" :width="size" :height="size" :viewBox="SYMBOL_SQUARE_VIEW_BOX" role="img" :aria-label="i18n.global.t('app.name')" focusable="false">
    <g fill="none" :stroke-width="SYMBOL_STROKE_WIDTH" stroke-linecap="round" stroke-linejoin="round">
      <path :d="SYMBOL_W" stroke="var(--mark)" />
      <path :d="SYMBOL_TICK" stroke="var(--accent)" />
    </g>
  </svg>
</template>

<style scoped>
.app-mark { display: block; flex: none; }
</style>
