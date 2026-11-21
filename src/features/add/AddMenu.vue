<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { Repeat } from 'lucide-vue-next'
import type { AddPlacement } from '@/app/contracts'
import Icon from '@/ui/Icon.vue'
import { registerIcons } from '@/ui/icons'
import { ADD_KINDS, type AddKind } from './addKind'

registerIcons({ repeat: Repeat })

// The one "+" (redesign 2026-11, principle 4). Floating: the round button beside the phone's tab bar, its menu above it.
// Toolbar: the tablet's 44 px circle. Title: the desktop's "Añadir" button. With `direct` the button adds that kind at
// once (Tasks adds a task) and opens no menu.
const props = defineProps<{ placement: AddPlacement; direct?: AddKind }>()
const emit = defineEmits<{ choose: [kind: AddKind] }>()

const ICONS: Record<AddKind, string> = { task: 'list-checks', event: 'calendar', block: 'repeat' }

const { t } = useI18n()
const menuId = useId()
const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const hintId = (kind: AddKind) => `${menuId}-${kind}`
const label = computed(() => props.direct === 'task' ? t('tasks.sheet.new') : t('week.add'))

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

function press(): void {
  if (props.direct) emit('choose', props.direct)
  else if (open.value) close()
  else void show()
}

// The menu's button takes focus back before the sheet opens, so the sheet returns focus there when it closes.
function choose(kind: AddKind): void {
  close()
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
  <div ref="root" class="add-menu" :class="`is-${placement}`" @keydown.esc.stop="close()">
    <!-- In body: a bar's backdrop filter would otherwise make it the scrim's containing block and clip it to the bar. -->
    <Teleport to="body">
      <Transition name="scrim">
        <div v-if="open" class="add-scrim" aria-hidden="true" />
      </Transition>
    </Teleport>
    <button
      ref="trigger"
      type="button"
      class="add-trigger"
      :aria-label="placement === 'title' ? undefined : label"
      :aria-haspopup="direct ? undefined : 'menu'"
      :aria-expanded="direct ? undefined : open"
      :aria-controls="open ? menuId : undefined"
      data-testid="add-entry"
      :data-floating-add="placement === 'floating' || undefined"
      @click="press"
      @keydown.down="!direct && ($event.preventDefault(), show())"
    >
      <Icon :name="open ? 'x' : 'plus'" :size="placement === 'floating' ? 26 : placement === 'toolbar' ? 22 : 18" :stroke-width="2" />
      <span v-if="placement === 'title'">{{ t('week.add') }}</span>
    </button>
    <Transition name="menu">
      <div v-if="open" :id="menuId" ref="menu" class="menu" role="menu" :aria-label="t('week.add')" @keydown.down="move(1, $event)" @keydown.up="move(-1, $event)" @keydown.tab="close(false)">
        <button
          v-for="kind in ADD_KINDS"
          :key="kind"
          type="button"
          role="menuitem"
          class="menu-item"
          :aria-label="t(`week.addMenu.${kind}`)"
          :aria-describedby="hintId(kind)"
          :data-testid="`add-${kind}`"
          @click="choose(kind)"
        >
          <Icon :name="ICONS[kind]" :size="22" class="menu-icon" />
          <span class="menu-text">
            <span class="t-body">{{ t(`week.addMenu.${kind}`) }}</span>
            <span :id="hintId(kind)" class="t-footnote t-secondary">{{ t(`week.addMenu.${kind}Hint`) }}</span>
          </span>
        </button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.add-menu { position: relative; display: inline-flex; }
.add-trigger {
  position: relative;
  z-index: 1;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  border: 0;
  background: var(--tint);
  color: var(--tint-text);
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
  touch-action: manipulation;
}
.add-trigger:active { transform: scale(0.97); }
.is-floating .add-trigger { width: 60px; height: 60px; border-radius: 30px; box-shadow: var(--shadow-bar); }
.is-toolbar .add-trigger { width: var(--tap-target); height: var(--tap-target); border-radius: 50%; }
.is-title .add-trigger {
  min-height: var(--tap-target);
  padding: 0 var(--space-4);
  border-radius: var(--radius-control);
  font-size: 1.0625rem;
  font-weight: 600;
}

/* A light scrim says the menu is modal for a moment; a tap anywhere outside closes it. It sits under the bars (z 10–20),
   which hold the menu and its button. */
.add-scrim { position: fixed; inset: 0; z-index: 9; background: var(--scrim); opacity: 0.6; }
.scrim-enter-active, .scrim-leave-active { transition: opacity 0.15s; }
.scrim-enter-from, .scrim-leave-to { opacity: 0; }

.menu {
  position: absolute;
  z-index: 2;
  width: min(17.5rem, calc(100vw - 2 * var(--page-gutter)));
  padding: var(--space-1) 0;
  overflow: hidden;
  border-radius: var(--radius-card);
  /* Thicker than the bars' material: the menu's text must never compete with the page under it. */
  background: color-mix(in srgb, var(--surface) 94%, transparent);
  -webkit-backdrop-filter: var(--material-filter);
  backdrop-filter: var(--material-filter);
  box-shadow: var(--shadow-floating);
  inset-inline-end: 0;
  transform-origin: top right;
}
.is-floating .menu {
  bottom: calc(100% + var(--space-3));
  max-height: calc(100dvh - var(--tabbar-inset) - var(--space-3) - var(--safe-top) - var(--space-4));
  overflow-y: auto;
  overscroll-behavior: contain;
  transform-origin: bottom right;
}
.is-toolbar .menu, .is-title .menu { top: calc(100% + var(--space-2)); }
.menu-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  width: 100%;
  min-height: 60px;
  padding: 0 var(--space-4);
  border: 0;
  background: transparent;
  color: var(--label);
  text-align: start;
  transition: background-color 0.1s;
}
.menu-icon { color: var(--tint-label); }
.menu-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  padding-block: 9px;
}
.menu-item + .menu-item .menu-text { border-top: 0.5px solid var(--separator); }
.menu-item:active { background: var(--fill); }
.menu-item:focus-visible { outline-offset: -2px; }

.menu-enter-active, .menu-leave-active { transition: opacity 0.15s, transform 0.2s var(--ease-out); }
.menu-enter-from, .menu-leave-to { opacity: 0; transform: scale(0.96); }
@media (prefers-reduced-motion: reduce) {
  .add-trigger:active { transform: none; opacity: 0.7; }
  .menu-enter-from, .menu-leave-to { transform: none; }
}
@media (forced-colors: active) {
  .add-trigger { border: 1px solid ButtonText; }
}
</style>
