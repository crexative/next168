<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
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

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div class="toast-region" role="status" aria-live="polite">
    <Transition name="toast">
      <div
        v-if="toast"
        :key="toast.id"
        class="toast"
        data-testid="undo-toast"
        @pointerenter="pause"
        @pointerleave="resume"
        @focusin="pause"
        @focusout="resume"
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
  display: flex;
  justify-content: center;
  padding: 0 var(--space-4);
  pointer-events: none;
}
.toast {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  max-width: 28rem;
  padding: var(--space-1) var(--space-1) var(--space-1) var(--space-4);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-floating);
  pointer-events: auto;
}
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
  .toast-region { bottom: var(--space-6); padding-inline-start: calc(var(--sidebar-width) + var(--space-4)); }
}
@media (prefers-reduced-motion: reduce) {
  .toast-enter-from, .toast-leave-to { transform: none; }
}
@media (forced-colors: active) {
  .toast { border: 1px solid CanvasText; }
}
</style>
