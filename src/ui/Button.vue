<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue'
import { watchPressEnd } from './pressEnd'

// One rule for every action: filled for the primary one (hugs its label), tinted for secondary ones, plain for
// tertiary ones (flush with the content edge). `block` spans the width only on narrow screens; `href` renders a
// link that looks and behaves like the button (empty-state calls to action, never an underlined link).
withDefaults(defineProps<{
  variant?: 'filled' | 'tinted' | 'plain'
  destructive?: boolean
  type?: 'button' | 'submit'
  disabled?: boolean
  block?: boolean
  href?: string
}>(), { variant: 'filled', type: 'button' })

// Press feedback starts on pointer-down, before the click event fires; it ends wherever the press ends.
const pressed = ref(false)
let stopWatchingPress: (() => void) | undefined

function press(event: PointerEvent): void {
  release()
  pressed.value = true
  stopWatchingPress = watchPressEnd(event.pointerId, release)
}

function release(): void {
  stopWatchingPress?.()
  stopWatchingPress = undefined
  pressed.value = false
}

onBeforeUnmount(release)
</script>

<template>
  <component
    :is="href ? 'a' : 'button'"
    class="ui-button"
    :class="[`is-${variant}`, { 'is-destructive': destructive, 'is-block': block }]"
    :type="href ? undefined : type"
    :href="href && !disabled ? href : undefined"
    :disabled="href ? undefined : disabled"
    :aria-disabled="href && disabled ? 'true' : undefined"
    :data-pressed="pressed || undefined"
    @pointerdown="press"
    @pointerup="release"
    @pointercancel="release"
    @pointerleave="release"
  >
    <slot />
  </component>
</template>

<style scoped>
.ui-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  /* fit-content keeps a button at its label's width even inside a stretching flex column or grid. */
  width: fit-content;
  max-width: 100%;
  min-width: var(--tap-target);
  min-height: var(--tap-target);
  padding: 0 var(--space-4);
  border: 0;
  border-radius: var(--radius-control);
  font-size: 1.0625rem;
  font-weight: 600;
  line-height: 1.3;
  /* A word wider than the button ("Tagesabschluss" at 320 px and 200 % text) is hyphenated in the page's language
     instead of running out of the button, where it covered its own link's centre. */
  hyphens: auto;
  text-align: center;
  text-decoration: none;
  transition: transform 0.1s var(--ease-out), background-color 0.1s, opacity 0.1s;
  touch-action: manipulation;
}
.is-filled { background: var(--tint); color: var(--tint-text); }
.is-tinted { background: color-mix(in srgb, var(--tint) 12%, transparent); color: var(--tint-label); }
/* Tertiary actions sit on the content's leading edge, like text; the 44 px target stays. */
.is-plain { padding-inline: 0; background: transparent; color: var(--tint-label); }
.is-filled.is-destructive { background: var(--danger); color: #fff; }
.is-tinted.is-destructive { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger-label); }
.is-plain.is-destructive { color: var(--danger-label); }
.ui-button[data-pressed] { transform: scale(0.97); opacity: 0.85; }
.ui-button:disabled, .ui-button[aria-disabled='true'] { opacity: 0.4; cursor: not-allowed; }
/* A wide bar only where the thumb needs it; from 480 px up every button hugs its label. */
@media (max-width: 479px) {
  .is-block { display: flex; width: 100%; }
  .is-block.is-plain { padding-inline: var(--space-4); }
}

@media (prefers-reduced-motion: reduce) {
  .ui-button[data-pressed] { transform: none; opacity: 0.7; }
}
@media (forced-colors: active) {
  .ui-button { border: 1px solid ButtonText; }
  .is-plain { border-color: transparent; }
}
</style>
