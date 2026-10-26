<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from './Icon.vue'
import { prefersReducedMotion, useMediaQuery } from './useMediaQuery'
import { registerUnsavedInput } from './unsavedGuard'
import { releaseVelocity, rubberBand, shouldDismiss, springTo, type Sample } from './sheetMotion'
import { isHover, watchPressEnd } from './pressEnd'
import { anyFullScreenOpen, closedSheet, closingSheet, droppedSheet, openSheet, reopenedSheet, type SheetEntry } from './sheetStack'

// A phone sheet ends with a dismiss button within the thumb's reach (`dismissLabel`, default "Cancel");
// `noDismiss` leaves it out for a sheet whose own actions already include one. A `footer` slot replaces it with the
// sheet's own actions, pinned below the scrolling body at every width.
// `fullHeight`: a tall panel whose body is the only scroller (a guided flow). `largeTargets`: 48 px controls for the whole
// panel. `closeLabel`: what the ✕ is named. `locked`: nothing closes it (a save is pending).
const props = defineProps<{
  open: boolean; title: string; dirty?: boolean; dismissLabel?: string; noDismiss?: boolean
  fullHeight?: boolean; largeTargets?: boolean; closeLabel?: string; locked?: boolean
}>()
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
let entry: SheetEntry | null = null
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

// Once unmounted a sheet does nothing more: a pending animation ends at once and every step after an await checks
// `disposed` (a test or a page can end while a close is under way; the document may be gone by then).
let disposed = false
let pendingWait: { timer: ReturnType<typeof setTimeout>; resolve: () => void } | undefined

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    pendingWait = { timer: setTimeout(() => { pendingWait = undefined; resolve() }, ms), resolve }
  })
}

async function animateIn(resumeFrom?: number): Promise<void> {
  const token = ++generation
  await nextTick()
  const element = panel.value
  if (disposed || !element || token !== generation) return
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
  if (disposed || token !== generation) return false
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
  if (props.locked) return
  emit('update:open', false)
}

// While a full-height panel is open, the visible part of the page (smaller when the on-screen keyboard is up) sizes it.
let stopViewport: (() => void) | undefined
const viewportHeight = ref<number | null>(null)

function watchViewport(): void {
  const viewport = typeof window === 'undefined' ? undefined : window.visualViewport
  if (!viewport) return
  const sync = () => { viewportHeight.value = Math.round(viewport.height) }
  sync()
  viewport.addEventListener('resize', sync)
  stopViewport = () => viewport.removeEventListener('resize', sync)
}

watch(() => props.open && props.fullHeight, (active) => {
  stopViewport?.()
  stopViewport = undefined
  viewportHeight.value = null
  if (active) watchViewport()
}, { immediate: true })

// A press on a control (the close button) is never a drag; elsewhere in the header it becomes one only after
// DRAG_THRESHOLD_PX of travel, and only then is the pointer captured, so a plain click still reaches its target.
function onGrabDown(event: PointerEvent): void {
  if (props.locked || isCentered.value || (event.pointerType === 'mouse' && event.button !== 0)) return
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

// Focus and the page's `data-sheet-open` are shared by every sheet on screen (sheetStack.ts): a sheet that closes while
// the next one opens never takes focus back from it. A sheet asked to open while a full-screen flow owns the screen
// waits, unrendered, and opens (taking focus) only once that flow is gone; closed while it waits, it never shows.
watch(() => props.open && (rendered.value || !anyFullScreenOpen()), async (open) => {
  if (open) {
    const interrupted = rendered.value
    if (interrupted) {
      animation?.stop()
      if (entry) reopenedSheet(entry)
    } else {
      entry = openSheet({ panel: () => panel.value })
    }
    rendered.value = true
    await animateIn(interrupted ? offset : undefined)
    if (disposed) return
    // The title, not the first control: opening a sheet must not light up a focus ring on its close button.
    ;(heading.value ?? panel.value)?.focus({ preventScroll: true })
  } else if (rendered.value) {
    endPress()
    dragStart = undefined
    if (entry) closingSheet(entry)
    if (await animateOut() && entry) {
      closedSheet(entry)
      entry = null
    }
  }
}, { immediate: true })

watch(() => props.open && props.dirty, (unsaved) => {
  releaseUnsaved?.()
  releaseUnsaved = unsaved ? registerUnsavedInput() : undefined
}, { immediate: true })

// Unmounted (its page went away, or a test ended), possibly mid-animation: it leaves the list of sheets now, while the
// document still exists, and its pending close resolves without acting (animateOut sees `disposed`).
onBeforeUnmount(() => {
  disposed = true
  ++generation
  stopViewport?.()
  endPress()
  animation?.stop()
  if (pendingWait) {
    clearTimeout(pendingWait.timer)
    pendingWait.resolve()
    pendingWait = undefined
  }
  releaseUnsaved?.()
  if (entry) droppedSheet(entry)
  entry = null
})
</script>

<template>
  <Teleport to="body">
    <div v-if="rendered" class="sheet-root" :class="{ 'is-shown': shown, 'is-centered': isCentered }">
      <div class="sheet-scrim" @click="requestClose" />
      <div
        ref="panel"
        class="sheet-panel"
        :class="{ 'is-full': fullHeight, 'is-large': largeTargets }"
        :style="viewportHeight !== null ? { '--vvh': `${viewportHeight}px` } : undefined"
        :aria-busy="locked || undefined"
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
            <button class="sheet-close" type="button" :aria-label="closeLabel ?? t('common.close')" :disabled="locked" @click="requestClose">
              <Icon name="x" :size="20" />
            </button>
          </div>
        </div>
        <div class="sheet-body"><slot /></div>
        <!-- A sheet's own decision (Approve and Cancel) stays in reach at every width while the body scrolls. -->
        <div v-if="$slots.footer" class="sheet-footer is-actions" data-testid="sheet-actions"><slot name="footer" /></div>
        <div v-else-if="!isCentered && !noDismiss" class="sheet-footer">
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
/* A guided flow: a tall panel, a body that scrolls, 48 px controls. --vvh follows the visible viewport (keyboard up). */
.sheet-panel.is-large { --tap-target: 48px; }
.sheet-panel.is-full { height: calc(min(var(--vvh, 100dvh), 100dvh) - var(--safe-top) - var(--space-6)); }
.sheet-close:disabled { opacity: 0.4; }
.sheet-grab { touch-action: none; padding-top: var(--space-2); cursor: grab; }
.sheet-title:focus { outline: none; }
.sheet-handle { display: block; width: 36px; height: 5px; margin: 0 auto var(--space-1); border-radius: 3px; background: var(--label-3); }
.sheet-header { display: flex; align-items: center; justify-content: space-between; padding: 0 var(--space-2) 0 var(--page-gutter); }
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
.sheet-body { flex: 1; overflow-y: auto; overscroll-behavior: contain; padding: var(--space-2) var(--page-gutter) var(--space-4); }
/* Within the thumb's reach at the bottom of a phone sheet, always visible while the body scrolls. */
.sheet-footer { flex: none; padding: var(--space-1) var(--page-gutter); border-top: 0.5px solid var(--separator); }
.sheet-footer.is-actions { padding: var(--space-3) var(--page-gutter) var(--space-4); }
.is-centered .sheet-footer.is-actions { padding-bottom: var(--space-3); }
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
.is-centered .sheet-panel.is-full { width: min(35rem, calc(100vw - 2rem)); height: min(42.5rem, calc(100dvh - 4rem)); }
.is-centered .sheet-grab { cursor: default; touch-action: auto; }
.is-centered .sheet-handle { display: none; }

@media (prefers-reduced-motion: reduce) {
  .is-centered .sheet-panel { transform: none; }
  .sheet-panel { transition: opacity 0.15s; }
  .sheet-root:not(.is-shown) .sheet-panel { opacity: 0; }
}
</style>
