<script setup lang="ts">
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'

defineProps<{ title: string; subtitle?: string; color: string; completeLabel: string; removeLabel: string }>()
const emit = defineEmits<{ complete: []; remove: [] }>()

const { t } = useI18n()
const SWIPE_COMPLETE_PX = 96
const offset = ref(0)
let startX: number | undefined

function onDown(event: PointerEvent): void {
  startX = event.clientX
}

function onMove(event: PointerEvent): void {
  if (startX === undefined) return
  offset.value = Math.min(0, event.clientX - startX)
}

function onUp(): void {
  if (startX === undefined) return
  const completed = offset.value <= -SWIPE_COMPLETE_PX
  startX = undefined
  offset.value = 0
  if (completed) emit('complete')
}
</script>

<template>
  <li class="task-row">
    <span class="swipe-hint t-subhead" aria-hidden="true"><Icon name="check" :size="18" /> {{ t('tasks.swipeComplete') }}</span>
    <div
      class="task-content"
      :style="{ transform: `translateX(${offset}px)` }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="onUp"
    >
      <button class="check" type="button" :aria-label="completeLabel" @click="emit('complete')">
        <span class="check-ring" :style="{ borderColor: color }" />
      </button>
      <span class="task-text">
        <span class="t-body title">{{ title }}</span>
        <span v-if="subtitle" class="t-footnote t-secondary">{{ subtitle }}</span>
        <slot />
      </span>
      <button class="remove" type="button" :aria-label="removeLabel" @click="emit('remove')">
        <Icon name="x" :size="18" />
      </button>
    </div>
  </li>
</template>

<style scoped>
.task-row { position: relative; overflow: hidden; background: var(--success); }
.task-row + .task-row { border-top: 1px solid var(--separator); }
.swipe-hint { position: absolute; inset-block: 0; inset-inline-end: var(--space-4); display: flex; align-items: center; gap: var(--space-1); color: #fff; }
.task-content { position: relative; display: flex; align-items: center; gap: var(--space-2); min-height: var(--tap-target); padding: var(--space-1) var(--space-1) var(--space-1) 0; background: var(--surface); touch-action: pan-y; }
.check, .remove { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--tap-target); height: var(--tap-target); border: 0; background: transparent; color: var(--label-2); }
.check-ring { width: 22px; height: 22px; border: 2px solid; border-radius: 50%; }
.task-text { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; padding-block: var(--space-1); }
.title { overflow-wrap: anywhere; }
</style>
