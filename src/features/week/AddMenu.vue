<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import type { AddKind } from './addKind'

withDefaults(defineProps<{ variant?: 'toolbar' | 'fab'; placement?: 'below' | 'above' }>(), { variant: 'toolbar', placement: 'below' })
const emit = defineEmits<{ choose: [kind: AddKind] }>()

// One plain verb for each thing "+" can add, with what it is in a line.
const KINDS = ['task', 'event', 'block'] as const

const { t } = useI18n()
const menuId = useId()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const hintId = (kind: AddKind) => `${menuId}-${kind}`

function items(): HTMLButtonElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])
}

async function show(): Promise<void> {
  open.value = true
  await nextTick()
  items()[0]?.focus()
}

function close(restoreFocus = true): void {
  if (!open.value) return
  open.value = false
  if (restoreFocus) trigger.value?.focus()
}

function choose(kind: AddKind): void {
  close(false)
  emit('choose', kind)
}

function move(step: number, event: KeyboardEvent): void {
  const list = items()
  const at = list.indexOf(document.activeElement as HTMLButtonElement)
  list[(at + step + list.length) % list.length]?.focus()
  event.preventDefault()
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close(false)
}

watch(open, (isOpen) => {
  if (isOpen) document.addEventListener('pointerdown', onDocumentPointerDown)
  else document.removeEventListener('pointerdown', onDocumentPointerDown)
})
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocumentPointerDown))
</script>

<template>
  <div ref="root" class="add-menu" :class="[`is-${variant}`, `is-${placement}`]" @keydown.esc.stop="close()">
    <button
      ref="trigger"
      type="button"
      class="add-trigger"
      :aria-label="t('week.add')"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="open ? menuId : undefined"
      data-testid="week-add"
      @click="open ? close() : show()"
      @keydown.down.prevent="show"
    >
      <Icon name="plus" :size="24" />
    </button>
    <Transition name="menu">
      <div v-if="open" :id="menuId" ref="menu" class="menu" role="menu" :aria-label="t('week.add')" @keydown.down="move(1, $event)" @keydown.up="move(-1, $event)" @keydown.tab="close(false)">
        <button
          v-for="kind in KINDS"
          :key="kind"
          type="button"
          role="menuitem"
          class="menu-item"
          :aria-label="t(`week.addMenu.${kind}`)"
          :aria-describedby="hintId(kind)"
          :data-testid="`add-${kind}`"
          @click="choose(kind)"
        >
          <span class="t-body">{{ t(`week.addMenu.${kind}`) }}</span>
          <span :id="hintId(kind)" class="t-footnote t-secondary">{{ t(`week.addMenu.${kind}Hint`) }}</span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.add-menu { position: relative; display: inline-flex; }
.add-trigger {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tint-label);
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
}
.add-trigger:active { transform: scale(0.97); }
.is-fab .add-trigger {
  width: 3.5rem;
  height: 3.5rem;
  background: var(--tint);
  color: var(--tint-text);
  box-shadow: var(--shadow-floating);
}

.menu {
  position: absolute;
  z-index: 30;
  width: max-content;
  min-width: 11rem;
  max-width: min(18rem, calc(100vw - 2 * var(--space-4)));
  padding: var(--space-1);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-floating);
  transform-origin: top right;
}
.is-below .menu { top: 100%; inset-inline-end: 0; margin-top: var(--space-1); }
.is-above .menu { bottom: 100%; inset-inline-end: 0; margin-bottom: var(--space-2); transform-origin: bottom right; }
.menu-item {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  width: 100%;
  min-height: var(--tap-target);
  padding: var(--space-2) var(--space-3);
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--label);
  text-align: start;
  transition: background-color 0.1s;
}
.menu-item:active { background: color-mix(in srgb, var(--label-2) 14%, transparent); }
.menu-item:focus-visible { outline-offset: -2px; }

.menu-enter-active, .menu-leave-active { transition: opacity 0.15s, transform 0.2s var(--ease-out); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: scale(0.96); }
@media (prefers-reduced-motion: reduce) {
  .add-trigger:active { transform: none; opacity: 0.7; }
  .menu-enter-from, .menu-leave-to { transform: none; }
}
</style>
