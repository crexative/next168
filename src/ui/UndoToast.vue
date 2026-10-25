<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useUndoToast } from './undoToast'

const { t } = useI18n()
const { toast, undo, pause, resume } = useUndoToast()

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

// Cmd/Ctrl+Z undoes the offered change from anywhere except a text field, where it keeps undoing typing.
function onKeydown(event: KeyboardEvent): void {
  if (!toast.value || event.key.toLowerCase() !== 'z' || !(event.metaKey || event.ctrlKey) || event.shiftKey || event.altKey) return
  if (isEditable(event.target)) return
  event.preventDefault()
  undo()
}

// Focus moving between parts of the toast is not leaving it.
function onFocusOut(event: FocusEvent): void {
  const toastElement = event.currentTarget as HTMLElement
  if (event.relatedTarget instanceof Node && toastElement.contains(event.relatedTarget)) return
  resume('focus')
}

// A toast replaced by a new one goes at once: the new toast and its Undo are there immediately (first in the tab order),
// and two Undo buttons never share the cell. A toast that is simply dismissed fades out.
function onLeave(element: Element): void {
  if (toast.value) (element as HTMLElement).style.display = 'none'
}

// Time spent in another tab does not count: the person cannot act on the toast there.
function onVisibilityChange(): void {
  if (document.visibilityState === 'hidden') pause('hidden')
  else resume('hidden')
}

// The toast's height is published, so a floating button on the same edge (Week's "+") stacks above it instead of under it.
const region = ref<HTMLElement | null>(null)
let observer: ResizeObserver | undefined

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('visibilitychange', onVisibilityChange)
  onVisibilityChange()
  if (!region.value || typeof ResizeObserver === 'undefined') return
  // The layout size: a transform on the way in (the toast slides up) does not change the room it takes.
  observer = new ResizeObserver(([entry]) => {
    const height = entry?.borderBoxSize?.[0]?.blockSize ?? entry?.contentRect.height ?? 0
    window.document.documentElement.style.setProperty('--undo-toast-height', `${height}px`)
  })
  observer.observe(region.value)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  observer?.disconnect()
  window.document.documentElement.style.removeProperty('--undo-toast-height')
})
</script>

<template>
  <div ref="region" class="toast-region" role="status" aria-live="polite">
    <Transition name="toast" @leave="onLeave">
      <div
        v-if="toast"
        :key="toast.id"
        class="toast"
        data-testid="undo-toast"
        @pointerenter="pause('pointer')"
        @pointerleave="resume('pointer')"
        @focusin="pause('focus')"
        @focusout="onFocusOut"
      >
        <span class="t-subhead">{{ toast.message }}</span>
        <button class="toast-action t-headline" type="button" @click="undo">{{ t('common.undo') }}</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.toast-region {
  position: fixed;
  inset-inline: 0;
  bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--space-3));
  z-index: 40;
  /* One cell: a toast replacing another takes its place at once (the old one is hidden as it leaves). */
  display: grid;
  justify-items: center;
  padding: 0 var(--page-gutter);
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  /* Never wider than the region, whatever the text width: the Undo button and its focus ring stay on screen. */
  grid-area: 1 / 1;
  min-width: 0;
  max-width: min(28rem, 100%);
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-floating);
  pointer-events: auto;
}
.toast > .t-subhead { min-width: 0; overflow-wrap: anywhere; }
.toast-action {
  flex: none;
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  padding: 0 var(--space-3);
  border: 0;
  background: transparent;
  color: var(--tint-label);
}
.toast-enter-active, .toast-leave-active { transition: opacity 0.2s, transform 0.2s var(--ease-out); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }

@media (min-width: 1024px) {
  .toast-region { bottom: var(--space-6); padding-inline-start: calc(var(--sidebar-inset, var(--sidebar-width)) + var(--space-4)); }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-from, .toast-leave-to { transform: none; }
}
@media (forced-colors: active) {
  .toast { border: 1px solid CanvasText; }
}
</style>

<style>
/* --undo-toast-lift is how far the toast reaches above the tab bar while it shows (0 otherwise). */
html:has([data-testid='undo-toast']) { --undo-toast-lift: calc(var(--undo-toast-height, 0px) + var(--space-3)); }
/* While a toast floats over the end of the page, the page keeps room for it: the last control (a form's Save) can
   always be scrolled clear of it instead of sitting underneath for 15 seconds. */
html:has([data-testid='undo-toast']) .content { padding-bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--space-3) + var(--banners-height, 0px) + var(--tap-target) + var(--space-6)); }
@media (min-width: 1024px) {
  html:has([data-testid='undo-toast']) .content { padding-bottom: calc(var(--space-6) + var(--banners-height, 0px) + var(--tap-target) + var(--space-6)); }
}
</style>
