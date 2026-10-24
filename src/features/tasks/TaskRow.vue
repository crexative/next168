<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import { isHover, watchPressEnd } from '@/ui/pressEnd'

defineProps<{ title: string; subtitle?: string; color: string; completeLabel: string; removeLabel: string }>()
const emit = defineEmits<{ complete: []; remove: [] }>()

const { t } = useI18n()
const SWIPE_COMPLETE_PX = 96
const offset = ref(0)
let startX: number | undefined
let stopWatchingPress: (() => void) | undefined

// A swipe whose release happens elsewhere (or is cut by the window losing focus) never completes the task.
function cancelSwipe(): void {
  stopWatchingPress?.()
  stopWatchingPress = undefined
  startX = undefined
  offset.value = 0
}

function onDown(event: PointerEvent): void {
  cancelSwipe()
  startX = event.clientX
  stopWatchingPress = watchPressEnd(event.pointerId, cancelSwipe)
}

function onMove(event: PointerEvent): void {
  if (startX === undefined) return
  if (isHover(event)) {
    cancelSwipe()
    return
  }
  offset.value = Math.min(0, event.clientX - startX)
}

function onUp(): void {
  if (startX === undefined) return
  const completed = offset.value <= -SWIPE_COMPLETE_PX
  cancelSwipe()
  if (completed) emit('complete')
}

onBeforeUnmount(() => stopWatchingPress?.())
</script>

<template>
  <li class="task-row" :class="{ 'is-swiping': offset < 0 }">
    <span class="swipe-hint t-subhead" aria-hidden="true"><Icon name="check" :size="18" /> {{ t('tasks.swipeComplete') }}</span>
    <div
      class="task-content"
      :style="{ transform: `translateX(${offset}px)` }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="cancelSwipe"
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
.task-row { position: relative; overflow: hidden; }
/* The green swipe track exists only while swiping: at rest its anti-aliased edge bled green around the card's rounded corners. */
.task-row::before { content: ''; position: absolute; inset: 0; background: var(--success); visibility: hidden; }
.task-row.is-swiping::before { visibility: visible; }
/* The separator belongs to the row's surface: on the green swipe track behind it, a translucent line turned green. */
.task-row + .task-row .task-content::before { content: ''; position: absolute; top: 0; right: 0; left: calc(var(--space-1) + var(--tap-target) + var(--space-2)); border-top: 1px solid var(--separator); }
.swipe-hint { position: absolute; inset-block: 0; inset-inline-end: var(--space-4); display: flex; align-items: center; gap: var(--space-1); color: #fff; }
.task-content { position: relative; display: flex; align-items: center; gap: var(--space-2); min-height: var(--tap-target); padding: var(--space-1); background: var(--surface); touch-action: pan-y; }
.check, .remove { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--tap-target); height: var(--tap-target); border: 0; background: transparent; color: var(--label-2); }
/* The row clips its content for the swipe, so these round buttons draw their focus ring inside. */
.check, .remove { border-radius: 50%; }
.check:focus-visible, .remove:focus-visible { outline-offset: -2px; }
.check-ring { width: 22px; height: 22px; border: 2px solid; border-radius: 50%; }
.task-text { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; padding-block: var(--space-1); }
.title { overflow-wrap: anywhere; }
</style>
