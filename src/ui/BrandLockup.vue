<script setup lang="ts">
// The horizontal lockup (symbol and wordmark) where the app shows its mark with its name. The wordmark is drawn in
// --label so it follows the appearance; its accessible name is the app's name.
import { computed } from 'vue'
import { i18n } from '@/i18n'
import {
  LOCKUP_SYMBOL_TRANSFORM, LOCKUP_VIEW_BOX, LOCKUP_WORDMARK_TRANSFORM, SYMBOL_STROKE_WIDTH, SYMBOL_TICK, SYMBOL_W, WORDMARK_PATH,
} from './brandMark'

const props = withDefaults(defineProps<{ height?: number }>(), { height: 28 })
const [, , boxWidth, boxHeight] = LOCKUP_VIEW_BOX.split(' ').map(Number) as [number, number, number, number]
const width = computed(() => Math.round(props.height * boxWidth / boxHeight * 100) / 100)
</script>

<template>
  <svg class="brand-lockup" :width="width" :height="height" :viewBox="LOCKUP_VIEW_BOX" role="img" :aria-label="i18n.global.t('app.name')" focusable="false">
    <g :transform="LOCKUP_SYMBOL_TRANSFORM" fill="none" :stroke-width="SYMBOL_STROKE_WIDTH" stroke-linecap="round" stroke-linejoin="round">
      <path :d="SYMBOL_W" stroke="var(--mark)" />
      <path :d="SYMBOL_TICK" stroke="var(--accent)" />
    </g>
    <path :transform="LOCKUP_WORDMARK_TRANSFORM" :d="WORDMARK_PATH" fill="var(--label)" />
  </svg>
</template>

<style scoped>
.brand-lockup { display: block; flex: none; }
</style>
