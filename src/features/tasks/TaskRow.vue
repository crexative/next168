<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import { isHover, watchPressEnd } from '@/ui/pressEnd'

defineProps<{ title: string; subtitle?: string; color: string; completeLabel: string }>()
// The circle completes; a tap on the text opens the task; a swipe to the left removes it (the screen offers Undo).
const emit = defineEmits<{ complete: []; open: []; remove: [] }>()

const { t } = useI18n()
const SWIPE_REMOVE_PX = 96
// A press that travelled this far was a swipe, not a tap, even if it did not reach the end of the swipe.
const TAP_SLOP_PX = 8
const offset = ref(0)
let startX: number | undefined
let swiped = false
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
  swiped = false
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
  if (Math.abs(event.clientX - startX) > TAP_SLOP_PX) swiped = true
}

function onUp(): void {
  if (startX === undefined) return
  const removed = offset.value <= -SWIPE_REMOVE_PX
  cancelSwipe()
  if (removed) emit('remove')
}

function onOpen(): void {
  if (!swiped) emit('open')
  swiped = false
}

onBeforeUnmount(() => stopWatchingPress?.())
</script>

<template>
  <li class="task-row" :class="{ 'is-swiping': offset < 0 }">
    <span class="swipe-hint t-subhead" aria-hidden="true"><Icon name="trash-2" :size="18" /> {{ t('tasks.swipeRemove') }}</span>
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
      <button class="task-text" type="button" @click="onOpen">
        <span class="t-body title">{{ title }}</span>
        <span v-if="subtitle" class="t-footnote t-secondary">{{ subtitle }}</span>
        <slot />
      </button>
    </div>
  </li>
</template>

<style scoped>
.task-row { position: relative; overflow: hidden; }
/* The red swipe track exists only while swiping: at rest its anti-aliased edge bled green around the card's rounded corners. */
.task-row::before { content: ''; position: absolute; inset: 0; background: color-mix(in srgb, var(--danger) 80%, #000); visibility: hidden; }
.task-row.is-swiping::before { visibility: visible; }
/* The separator belongs to the row's surface: on the green swipe track behind it, a translucent line turned green. */
.task-row + .task-row .task-content::before { content: ''; position: absolute; top: 0; right: 0; left: calc(var(--space-4) + var(--tap-target) + var(--space-2)); border-top: 1px solid var(--separator); }
.swipe-hint { position: absolute; inset-block: 0; inset-inline-end: var(--space-4); display: flex; align-items: center; gap: var(--space-1); color: #fff; }
.task-content { position: relative; display: flex; align-items: center; gap: var(--space-2); min-height: var(--tap-target); padding: var(--space-1) var(--space-4); background: var(--surface); touch-action: pan-y; }
.check { display: inline-flex; align-items: center; justify-content: center; flex: none; width: var(--tap-target); height: var(--tap-target); border: 0; background: transparent; color: var(--label-2); }
/* The row clips its content for the swipe, so these buttons draw their focus ring inside. */
.check { border-radius: 50%; }
.check:focus-visible, .task-text:focus-visible { outline-offset: -2px; }
.check-ring { width: 22px; height: 22px; border: 2px solid; border-radius: 50%; }
.task-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  align-self: stretch;
  min-width: 0;
  padding: var(--space-1) 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: inherit;
  text-align: start;
}
.title { overflow-wrap: anywhere; }
</style>
