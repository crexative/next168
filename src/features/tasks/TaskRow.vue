<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import './registerIcons'
import { isHover, watchPressEnd } from '@/ui/pressEnd'

// `timeline` lays the row out like Today's list (R_Hoy): an empty time column, a dashed bar in the task's colour, the
// text, and the circle at the trailing end.
// `list` is a plain row on the page (R_Tareas): a 24 px ring in the task's colour, the title and its meta. `attention`
// draws the meta in amber (overdue, does not fit).
withDefaults(defineProps<{ title: string; subtitle?: string; color: string; completeLabel: string; variant?: 'list' | 'timeline'; attention?: boolean }>(), { variant: 'list', attention: false })
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
  <li class="task-row" :class="[`is-${variant}`, { 'is-swiping': offset < 0 }]" :style="{ '--task-color': color }">
    <span class="swipe-hint t-subhead" aria-hidden="true"><Icon name="trash-2" :size="18" /> {{ t('tasks.swipeRemove') }}</span>
    <div
      class="task-content"
      :style="{ transform: `translateX(${offset}px)` }"
      @pointerdown="onDown"
      @pointermove="onMove"
      @pointerup="onUp"
      @pointercancel="cancelSwipe"
    >
      <template v-if="variant === 'timeline'">
        <span class="timeline-time" aria-hidden="true" />
        <span class="timeline-bar" aria-hidden="true" />
      </template>
      <button v-else class="check" type="button" :aria-label="completeLabel" @click="emit('complete')">
        <span class="check-ring" :style="{ borderColor: color }" />
      </button>
      <button class="task-text" type="button" @click="onOpen">
        <span class="t-body title">{{ title }}</span>
        <span v-if="subtitle" class="t-footnote meta" :class="{ 'is-attention': attention }">{{ subtitle }}</span>
        <slot />
      </button>
      <button v-if="variant === 'timeline'" class="check" type="button" :aria-label="completeLabel" @click="emit('complete')">
        <span class="check-ring" />
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
.task-row + .task-row .task-content::before { content: ''; position: absolute; top: 0; right: 0; left: calc(var(--card-padding) + var(--tap-target) + var(--space-2)); border-top: 1px solid var(--separator); }
.swipe-hint { position: absolute; inset-block: 0; inset-inline-end: var(--space-4); display: flex; align-items: center; gap: var(--space-1); color: #fff; }
.task-content { position: relative; display: flex; align-items: center; gap: var(--space-2); min-height: var(--row-min-height); padding: var(--space-1) var(--card-padding); background: var(--surface); touch-action: pan-y; }
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
  /* With the row's own padding this is the row padding token above and below the text; the button keeps the full height. */
  padding: calc(var(--row-padding-block) - var(--space-1)) 0;
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: inherit;
  text-align: start;
}
.title { overflow-wrap: anywhere; }
.meta { color: var(--label-2); }
.meta.is-attention { color: var(--warning-label); }
/* Tareas: plain rows on the page; the 44 px circle target is pulled to the gutter so the 24 px ring lines up with it. */
.is-list .task-content { padding: var(--space-1) var(--page-gutter) var(--space-1) calc(var(--page-gutter) - 10px); background: var(--bg); }
.is-list + .is-list .task-content::before { left: calc(var(--page-gutter) - 10px + var(--tap-target) + var(--space-2)); border-top-width: 0.5px; }
.is-list .check-ring { width: 24px; height: 24px; }
/* With a pointer, the row a press would open shows itself (R_EscritorioTareas). */
@media (hover: hover) { .is-list .task-content:hover { background: var(--fill); } }
/* Today's list: plain rows on the page, grid like the timeline (56 px time, 4 px bar, text, 44 px circle). */
.is-timeline .task-content { display: grid; grid-template-columns: 56px 4px minmax(0, 1fr) var(--tap-target); gap: var(--space-3); padding: 10px var(--page-gutter); background: var(--bg); }
.is-timeline + .is-timeline .task-content::before { left: calc(var(--page-gutter) + 56px + 4px + 2 * var(--space-3)); border-top-width: 0.5px; }
.timeline-bar { align-self: stretch; border-radius: 2px; background: repeating-linear-gradient(to bottom, var(--task-color) 0 5px, transparent 5px 8px); }
.is-timeline .check-ring { width: 24px; height: 24px; border-color: var(--label-2); }
</style>
