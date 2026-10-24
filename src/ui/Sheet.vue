<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'
import { prefersReducedMotion, useMediaQuery } from './useMediaQuery'
import { registerUnsavedInput } from './unsavedGuard'
import { releaseVelocity, rubberBand, shouldDismiss, springTo, type Sample } from './sheetMotion'
import { isHover, watchPressEnd } from './pressEnd'

// A phone sheet ends with a dismiss button within the thumb's reach (`dismissLabel`, default "Cancel");
// `noDismiss` leaves it out for a sheet whose own actions already include one.
const props = defineProps<{ open: boolean; title: string; dirty?: boolean; dismissLabel?: string; noDismiss?: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()

const { t } = useI18n()
const titleId = useId()
const isCentered = useMediaQuery('(min-width: 768px)')

const rendered = ref(false)
const shown = ref(false)
const panel = ref<HTMLElement | null>(null)
const heading = ref<HTMLElement | null>(null)

const FADE_MS = 150
// Hysteresis: a press becomes a drag only after this much travel, so taps keep working everywhere in the header.
const DRAG_THRESHOLD_PX = 10
const INTERACTIVE = 'button, a[href], input, select, textarea, label, [role="button"], [tabindex]:not([tabindex="-1"])'
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let offset = 0
let animation: { stop(): void } | undefined
let returnFocusTo: HTMLElement | null = null
let releaseUnsaved: (() => void) | undefined
let pressStart: { pointerId: number; pointerY: number } | undefined
let dragStart: { pointerY: number; offset: number } | undefined
let stopWatchingPress: (() => void) | undefined
let samples: Sample[] = []
let exitVelocity = 0
// Bumped by every open/close so a stale animation never acts on a newer state.
let generation = 0

function applyOffset(value: number): void {
  offset = value
  if (panel.value) panel.value.style.transform = `translateY(${value}px)`
}

function height(): number {
  return panel.value?.offsetHeight ?? 0
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function animateIn(resumeFrom?: number): Promise<void> {
  const token = ++generation
  await nextTick()
  const element = panel.value
  if (!element || token !== generation) return
  shown.value = true
  if (isCentered.value || prefersReducedMotion()) {
    applyOffset(0)
    return
  }
  const from = resumeFrom ?? height()
  applyOffset(from)
  animation = springTo(from, 0, applyOffset)
}

// Resolves true when the close ran to completion, false when a reopen superseded it.
async function animateOut(): Promise<boolean> {
  const token = ++generation
  shown.value = false
  if (isCentered.value || prefersReducedMotion()) {
    await wait(FADE_MS)
  } else {
    animation?.stop()
    const run = springTo(offset, height(), applyOffset, { velocity: exitVelocity, bounce: exitVelocity > 0 ? 0.15 : 0 })
    animation = run
    await run.finished
  }
  if (token !== generation) return false
  exitVelocity = 0
  rendered.value = false
  return true
}

function focusables(): HTMLElement[] {
  return panel.value ? Array.from(panel.value.querySelectorAll<HTMLElement>(FOCUSABLE)) : []
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    requestClose()
    return
  }
  if (event.key !== 'Tab') return
  const items = focusables()
  if (items.length === 0) {
    event.preventDefault()
    panel.value?.focus()
    return
  }
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (event.shiftKey && (active === first || active === panel.value || active === heading.value)) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  }
}

function requestClose(): void {
  emit('update:open', false)
}

// A press on a control (the close button) is never a drag; elsewhere in the header it becomes one only after
// DRAG_THRESHOLD_PX of travel, and only then is the pointer captured, so a plain click still reaches its target.
function onGrabDown(event: PointerEvent): void {
  if (isCentered.value || (event.pointerType === 'mouse' && event.button !== 0)) return
  if ((event.target as Element | null)?.closest(INTERACTIVE)) return
  endPress()
  pressStart = { pointerId: event.pointerId, pointerY: event.clientY }
  // Released outside the header, cancelled, or the window lost focus: the press (or drag) ends without a flick.
  stopWatchingPress = watchPressEnd(event.pointerId, () => {
    stopWatchingPress = undefined
    cancelPress()
  })
}

function endPress(): void {
  stopWatchingPress?.()
  stopWatchingPress = undefined
  pressStart = undefined
}

// A press that ended without its release reaching the sheet: no drag stays armed, and a started drag settles back.
function cancelPress(): void {
  endPress()
  if (!dragStart) return
  dragStart = undefined
  if (prefersReducedMotion()) applyOffset(0)
  else animation = springTo(offset, 0, applyOffset)
}

// Capture lost without a release (the element moved, the browser took over): the drag cannot finish normally.
function onLostCapture(): void {
  if (dragStart) cancelPress()
}

function onGrabMove(event: PointerEvent): void {
  if (isHover(event)) {
    if (pressStart || dragStart) cancelPress()
    return
  }
  if (!dragStart) {
    if (!pressStart || pressStart.pointerId !== event.pointerId || Math.abs(event.clientY - pressStart.pointerY) < DRAG_THRESHOLD_PX) return
    // Grabbing interrupts any running spring and tracks from where the sheet is now.
    animation?.stop()
    dragStart = { pointerY: event.clientY, offset }
    samples = [{ time: event.timeStamp, y: event.clientY }]
    ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
    return
  }
  samples.push({ time: event.timeStamp, y: event.clientY })
  applyOffset(rubberBand(dragStart.offset + event.clientY - dragStart.pointerY, height()))
}

function onGrabUp(event: PointerEvent): void {
  endPress()
  if (!dragStart) return
  dragStart = undefined
  const velocity = releaseVelocity([...samples, { time: event.timeStamp, y: event.clientY }])
  if (shouldDismiss(offset, velocity, height())) {
    exitVelocity = Math.max(velocity, 0)
    requestClose()
    return
  }
  if (prefersReducedMotion()) {
    applyOffset(0)
    return
  }
  animation = springTo(offset, 0, applyOffset, { velocity, bounce: 0.15 })
}

watch(() => props.open, async (open) => {
  if (open) {
    const interrupted = rendered.value
    if (interrupted) animation?.stop()
    else returnFocusTo = document.activeElement as HTMLElement | null
    rendered.value = true
    document.documentElement.dataset.sheetOpen = ''
    await animateIn(interrupted ? offset : undefined)
    // The title, not the first control: opening a sheet must not light up a focus ring on its close button.
    ;(heading.value ?? panel.value)?.focus({ preventScroll: true })
  } else if (rendered.value) {
    endPress()
    dragStart = undefined
    delete document.documentElement.dataset.sheetOpen
    if (await animateOut()) {
      returnFocusTo?.focus()
      returnFocusTo = null
    }
  }
}, { immediate: true })

watch(() => props.open && props.dirty, (unsaved) => {
  releaseUnsaved?.()
  releaseUnsaved = unsaved ? registerUnsavedInput() : undefined
}, { immediate: true })

onBeforeUnmount(() => {
  endPress()
  animation?.stop()
  releaseUnsaved?.()
  delete document.documentElement.dataset.sheetOpen
})
</script>

<template>
  <Teleport to="body">
    <div v-if="rendered" class="sheet-root" :class="{ 'is-shown': shown, 'is-centered': isCentered }">
      <div class="sheet-scrim" @click="requestClose" />
      <div
        ref="panel"
        class="sheet-panel"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown="onKeydown"
      >
        <div
          class="sheet-grab"
          @pointerdown="onGrabDown"
          @pointermove="onGrabMove"
          @pointerup="onGrabUp"
          @pointercancel="cancelPress"
          @lostpointercapture="onLostCapture"
        >
          <span class="sheet-handle" :title="t('common.dragHandle')" aria-hidden="true" />
          <div class="sheet-header">
            <h2 :id="titleId" ref="heading" class="sheet-title t-headline" tabindex="-1">{{ title }}</h2>
            <button class="sheet-close" type="button" :aria-label="t('common.close')" @click="requestClose">
              <Icon name="x" :size="20" />
            </button>
          </div>
        </div>
        <div class="sheet-body"><slot /></div>
        <div v-if="!isCentered && !noDismiss" class="sheet-footer">
          <button class="sheet-dismiss t-body" type="button" @click="requestClose">{{ dismissLabel ?? t('common.cancel') }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.sheet-root { position: fixed; inset: 0; z-index: 100; display: flex; align-items: flex-end; justify-content: center; }
.sheet-scrim { position: absolute; inset: 0; background: var(--scrim); opacity: 0; transition: opacity 0.2s; }
.is-shown .sheet-scrim { opacity: 1; }
.sheet-panel {
  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  max-height: calc(100dvh - var(--safe-top) - var(--space-6));
  background: var(--surface);
  border-radius: var(--radius-sheet) var(--radius-sheet) 0 0;
  box-shadow: var(--shadow-floating);
  padding-bottom: var(--safe-bottom);
  outline: none;
  /* Clips scrolled content to the rounded corners. */
  overflow: hidden;
}
.sheet-grab { touch-action: none; padding-top: var(--space-2); cursor: grab; }
.sheet-title:focus { outline: none; }
.sheet-handle { display: block; width: 36px; height: 5px; margin: 0 auto var(--space-1); border-radius: 3px; background: var(--label-3); }
.sheet-header { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-2) 0 var(--space-4); }
.sheet-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--label-2);
}
/* Drawn inside the button so the ring never crowds the sheet's rounded corner. */
.sheet-close:focus-visible { outline-offset: -2px; }
.sheet-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-2) var(--space-4) var(--space-4); }
/* Within the thumb's reach at the bottom of a phone sheet, always visible while the body scrolls. */
.sheet-footer { flex: none; padding: var(--space-1) var(--space-4); border-top: 0.5px solid var(--separator); }
.sheet-dismiss {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  min-height: var(--tap-target);
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--tint-label);
  font-weight: 600;
}
.sheet-dismiss:focus-visible { outline-offset: -2px; }

.sheet-root.is-centered { align-items: center; }
.is-centered .sheet-panel {
  width: min(32rem, calc(100vw - 2rem));
  max-height: min(40rem, calc(100dvh - 4rem));
  border-radius: var(--radius-sheet);
  padding-bottom: 0;
  opacity: 0;
  transform: scale(0.96);
  transition: opacity 0.15s, transform var(--spring-duration) var(--ease-out);
}
.is-centered.is-shown .sheet-panel { opacity: 1; transform: scale(1); }
.is-centered .sheet-grab { cursor: default; touch-action: auto; }
.is-centered .sheet-handle { display: none; }

@media (prefers-reduced-motion: reduce) {
  .is-centered .sheet-panel { transform: none; }
  .sheet-panel { transition: opacity 0.15s; }
  .sheet-root:not(.is-shown) .sheet-panel { opacity: 0; }
}
</style>
