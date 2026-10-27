<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import Icon from '@/ui/Icon.vue'
import { registerUnsavedInput } from '@/ui/unsavedGuard'
import AppMark from '@/ui/AppMark.vue'
import { pinToVisualViewport } from '@/ui/visualViewportPin'

// The guided setup's full-screen frame: a top bar (‹ to leave, the app's mark, which part of five) over the
// conversation. Going back is not a button here: the person taps an earlier answer to change it. Not a sheet: it covers the screen on a phone and centres a reading column on wider screens. It keeps
// focus inside, closes with Escape, and follows the visible viewport so the docked answers stay above the keyboard.
const props = defineProps<{
  open: boolean
  title: string
  closeLabel: string
  progressLabel: string
  countLabel: string
  part: number
  total: number
  locked: boolean
  dirty: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const titleId = useId()
const root = ref<HTMLElement | null>(null)
const pills = computed(() => Array.from({ length: props.total }, (_, index) => (index + 1 < props.part ? 'done' : index + 1 === props.part ? 'current' : 'next')))
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
              <Icon name="chevron-left" :size="28" />
            </button>
            <h2 :id="titleId" class="title">
              <AppMark class="mark" :size="32" />
              <span class="visually-hidden">{{ title }}</span>
            </h2>
            <p v-if="total > 0" class="progress" data-testid="setup-progress">
              <span class="visually-hidden">{{ progressLabel }}</span>
              <span class="pills" aria-hidden="true"><span v-for="(state, index) in pills" :key="index" class="pill" :class="`is-${state}`" /></span>
              <span class="count t-subhead" aria-hidden="true">{{ countLabel }}</span>
            </p>
          </div>
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
  height: min(var(--vv-height, 100dvh), 100dvh);
  background: var(--surface); color: var(--label); outline: none;
}
.bar { flex: none; padding: var(--safe-top) max(var(--space-2), var(--safe-right)) 0 max(var(--space-2), var(--safe-left)); border-bottom: 0.5px solid var(--separator); }
.bar-inner { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--space-2); min-height: calc(var(--tap-target) + var(--space-2)); }
.bar-button {
  display: inline-flex; flex: none; align-items: center; justify-content: center; width: var(--tap-target); height: var(--tap-target);
  border: 0; border-radius: 50%; background: transparent; color: var(--tint-label); touch-action: manipulation;
}
.bar-button:focus-visible { outline-offset: -2px; }
.bar-button:disabled { opacity: 0.4; }
.title { margin: 0; line-height: 0; }
.bar-inner > .bar-button { justify-self: start; }

/* Five steps: the parts done are light pills, the current one a darker pill, the rest quiet dots. */
.progress { display: flex; flex-direction: column; align-items: flex-end; justify-self: end; gap: 3px; margin: 0; padding-inline-end: var(--space-3); }
.pills { display: flex; align-items: center; gap: 5px; }
.count { color: var(--label-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
.pill { width: 7px; height: 7px; border-radius: 4px; background: var(--label-3); transition: width var(--spring-duration) var(--ease-out), background-color 0.2s; }
.pill.is-done { width: 18px; background: color-mix(in srgb, var(--tint) 45%, transparent); }
.pill.is-current { width: 22px; background: var(--tint); }

.setup-frame-enter-active { transition: opacity 0.25s var(--ease-out), transform var(--spring-duration) var(--ease-out); }
.setup-frame-leave-active { transition: opacity 0.15s; }
.setup-frame-enter-from { opacity: 0; transform: translateY(24px); }
.setup-frame-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .setup-frame-enter-active { transition: opacity 0.2s; }
  .setup-frame-enter-from { transform: none; }
  .pill { transition: none; }
}
</style>
