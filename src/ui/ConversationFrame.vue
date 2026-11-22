<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import Icon from './Icon.vue'
import { registerUnsavedInput } from './unsavedGuard'
import AppMark from './AppMark.vue'
import { pinToVisualViewport } from './visualViewportPin'

// The conversation frame (redesign 2026-11, DIRECTION §4): Weeklid talking to you, one question at a time. A top bar
// (‹ or × to leave, the app's mark, "Parte N de M" over a segmented bar) over the conversation. Going back is not a
// button here: the person taps an earlier answer to change it. Not a sheet: it covers the screen on a phone and
// centres a reading column on wider screens. It keeps focus inside, closes with Escape, and follows the visible
// viewport so the docked answers stay above the keyboard. Used by the guided setup and the daily check-in.
const props = withDefaults(defineProps<{
  open: boolean
  title: string
  closeLabel: string
  progressLabel: string
  countLabel: string
  part: number
  total: number
  locked: boolean
  dirty: boolean
  // ‹ leaves a flow that goes on later (setup); × cancels one (the check-in, an edit).
  leading?: 'back' | 'close'
}>(), { leading: 'back' })
const emit = defineEmits<{ close: [] }>()

const titleId = useId()
const root = ref<HTMLElement | null>(null)
const segments = computed(() => Array.from({ length: props.total }, (_, index) => (index + 1 <= props.part ? 'done' : 'next')))
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

let returnFocusTo: HTMLElement | null = null

function requestClose(): void {
  if (!props.locked) emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    requestClose()
    return
  }
  if (event.key !== 'Tab' || !root.value) return
  const items = Array.from(root.value.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((element) => element.getClientRects().length > 0 && !element.closest('[inert]'))
  const first = items[0]
  const last = items[items.length - 1]
  if (!first || !last) {
    event.preventDefault()
    return
  }
  const active = document.activeElement
  if (event.shiftKey && (active === first || !root.value.contains(active))) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && (active === last || !root.value.contains(active))) {
    event.preventDefault()
    first.focus()
  }
}

// While the frame is open it is pinned to the part of the page the person can see (smaller, and panned, while the
// on-screen keyboard is up).
let releasePin: (() => void) | undefined

watch(() => props.open, async (open, was) => {
  if (open && !releasePin) releasePin = pinToVisualViewport()
  if (open) {
    if (!was) returnFocusTo = document.activeElement as HTMLElement | null
  } else if (was) {
    releasePin?.()
    releasePin = undefined
    await nextTick()
    // The control that opened it, or, when that is gone (a menu that closed, a view that changed), the page's heading.
    const target = returnFocusTo?.isConnected ? returnFocusTo : document.querySelector<HTMLElement>('main h1')
    target?.focus?.({ preventScroll: true })
    returnFocusTo = null
  }
}, { immediate: true })

// The conversation normally focuses its question. Notices need the same handoff, including after an inert save.
watch(() => props.open && !props.locked, async (ready) => {
  if (!ready) return
  await nextTick()
  const frame = root.value
  if (!props.open || props.locked || !frame || frame.contains(document.activeElement)) return
  frame.querySelector<HTMLElement>('[data-setup-initial-focus]')?.focus({ preventScroll: true })
}, { immediate: true, flush: 'post' })

let releaseUnsaved: (() => void) | undefined
watch(() => props.open && props.dirty, (unsaved) => {
  releaseUnsaved?.()
  releaseUnsaved = unsaved ? registerUnsavedInput() : undefined
}, { immediate: true })

onBeforeUnmount(() => {
  releasePin?.()
  releaseUnsaved?.()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="setup-frame">
      <div
        v-if="open" ref="root" class="setup-frame" role="dialog" aria-modal="true" :aria-labelledby="titleId" :aria-busy="locked || undefined"
        @keydown="onKeydown"
      >
        <header class="bar">
          <div class="bar-inner">
            <button class="bar-button setup-close" type="button" :aria-label="closeLabel" :disabled="locked" @click="requestClose">
              <Icon :name="leading === 'close' ? 'x' : 'chevron-left'" :size="leading === 'close' ? 24 : 28" />
            </button>
            <h2 :id="titleId" class="title">
              <AppMark class="mark" :size="32" />
              <span class="visually-hidden">{{ title }}</span>
            </h2>
            <p v-if="total > 0" class="progress t-footnote" data-testid="setup-progress">
              <span class="visually-hidden">{{ progressLabel }}</span>
              <span class="count" aria-hidden="true">{{ countLabel }}</span>
            </p>
          </div>
          <!-- The parts as one 4 px bar of equal segments: done and current in the tint, the rest quiet. -->
          <span v-if="total > 0" class="segments" aria-hidden="true">
            <span v-for="(state, index) in segments" :key="index" class="segment" :class="`is-${state}`" />
          </span>
        </header>
        <slot />
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.setup-frame {
  --tap-target: 48px;
  --column: 40rem;
  position: fixed; inset: var(--vv-top, 0px) 0 auto; z-index: 100; display: flex; flex-direction: column;
  /* The frame's height, which the docks inside take their share of. */
  --frame-room: min(var(--vv-height, 100dvh), 100dvh);
  height: var(--frame-room);
  background: var(--surface); color: var(--label); outline: none;
}
.bar { flex: none; padding: var(--safe-top) max(var(--space-2), var(--safe-right)) 0 max(var(--space-2), var(--safe-left)); }
.bar-inner { display: grid; grid-template-columns: minmax(var(--tap-target), 1fr) auto minmax(0, 1fr); align-items: center; gap: var(--space-2); min-height: calc(var(--tap-target) + var(--space-2)); }
.bar-button {
  display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--tap-target); height: var(--tap-target);
  border: 0; border-radius: 50%; background: transparent; color: var(--label-2); touch-action: manipulation;
}
.bar-button:focus-visible { outline-offset: -2px; }
.bar-button:disabled { opacity: 0.4; }
.title { margin: 0; line-height: 0; }
.bar-inner > .bar-button { justify-self: start; }

.progress { justify-self: end; min-width: 0; margin: 0; padding-inline-end: 8px; text-align: end; }
/* The count grows with the text and may wrap between its words: it never runs out of the bar. */
.count { color: var(--label-2); font-size: 0.8125rem; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
/* A part added later (a pick that asks one more question) slides in as a new segment. */
.segments { display: flex; gap: 4px; margin: var(--space-1) var(--space-2) var(--space-2); }
.segment { flex: 1; height: 4px; border-radius: 2px; background: var(--fill); transition: background-color 0.2s, flex-grow var(--spring-duration) var(--ease-out); }
.segment.is-done { background: var(--tint); }

.setup-frame-enter-active { transition: opacity 0.25s var(--ease-out), transform var(--spring-duration) var(--ease-out); }
.setup-frame-leave-active { transition: opacity 0.15s; }
.setup-frame-enter-from { opacity: 0; transform: translateY(24px); }
.setup-frame-leave-to { opacity: 0; }
/* Tablet and desktop: a centred modal, 560 px wide, over the dimmed page (DIRECTION §4 anatomy); the page behind is
   inert while it is open (sheetStack.openFullScreen), so the dimming is drawn, not a layer to press. It is centred in
   the visible viewport (--vv-top, --vv-height: visualViewportPin), so an on-screen keyboard never covers it, and grows
   with its conversation up to 736 px (DIRECTION §6). Its margins are pixels, so large text never eats the question;
   a screen too short for a modal (a small landscape tablet) keeps the full-screen frame. */
@media (min-width: 768px) and (min-height: 700px) {
  .setup-frame {
    --column: 35rem;
    --modal-room: min(var(--vv-height, 100dvh), 100dvh);
    inset: auto 0; top: calc(var(--vv-top, 0px) + var(--modal-room) / 2); translate: 0 -50%;
    --frame-room: min(736px, var(--modal-room) - 32px);
    margin-inline: auto; width: min(35rem, 100vw - 32px); height: auto; max-height: var(--frame-room);
    border-radius: 24px; overflow: hidden;
    box-shadow: 0 0 0 100vmax var(--scrim), 0 16px 48px rgb(0 0 0 / 0.24);
  }
  /* No notch inside a centred card. */
  .bar { padding-top: 0; }
}
@media (prefers-reduced-motion: reduce) {
  .setup-frame-enter-active { transition: opacity 0.2s; }
  .setup-frame-enter-from { transform: none; }
  .segment { transition: none; }
}
</style>
