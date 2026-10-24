<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import { watchPressEnd } from '@/ui/pressEnd'
import type { ActualStatus } from './actuals'

// One trailing circle marks an item. A tap says "Hecho" (and takes it back when it is already done); a long
// press, right click or arrow-down opens the other two answers, "A medias" and "No". Tasks have no such
// answers, so they pass no `plannedMinutes` and the circle is just a checkbox.
const props = defineProps<{
  title: string
  status?: ActualStatus
  writable: boolean
  plannedMinutes?: number
  actualMinutes?: number
  // The item this control belongs to; a minutes draft opened for one item is dropped when the control is reused for another.
  itemKey: string
}>()
const emit = defineEmits<{
  record: [status: ActualStatus, actualMinutes?: number]
  clear: []
}>()

const { t } = useI18n()
const menuId = useId()
const inputId = useId()
const LONG_PRESS_MS = 450
// Hysteresis, like the sheet's drag: a press that travels this far is a scroll, not a long press.
const MOVE_TOLERANCE_PX = 10

const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const menu = ref<HTMLElement | null>(null)
const panel = ref<'menu' | 'minutes' | null>(null)
const above = ref(false)
const minutes = ref(0)
const minutesInput = ref<HTMLInputElement | null>(null)

const hasMenu = computed(() => props.plannedMinutes !== undefined)
const label = computed(() => {
  if (props.status === 'done') return t('today.status.stateDone', { title: props.title })
  if (props.status === 'partial') return t('today.status.statePartial', { title: props.title })
  if (props.status === 'skipped') return t('today.status.stateSkipped', { title: props.title })
  return t('today.status.markDone', { title: props.title })
})

function menuItems(): HTMLElement[] {
  return Array.from(menu.value?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

// Under the circle when there is room, above it when the tab bar and the screen's end would cover the menu.
function placeMenu(): void {
  const rect = trigger.value?.getBoundingClientRect()
  above.value = rect !== undefined && window.innerHeight - rect.bottom < 240
}

async function openMenu(): Promise<void> {
  if (!hasMenu.value || !props.writable) return
  placeMenu()
  panel.value = 'menu'
  await nextTick()
  menuItems()[0]?.focus()
}

function close(restoreFocus = true): void {
  if (panel.value === null) return
  panel.value = null
  if (restoreFocus) trigger.value?.focus()
}

let press: { x: number; y: number; timer: ReturnType<typeof setTimeout>; stop: () => void } | undefined
let swallowClick = false
let swallowReset: ReturnType<typeof setTimeout> | undefined

function endPress(): void {
  if (!press) return
  clearTimeout(press.timer)
  press.stop()
  press = undefined
}

function onPointerDown(event: PointerEvent): void {
  swallowClick = false
  endPress()
  if (!hasMenu.value || !props.writable || event.button !== 0) return
  const stop = watchPressEnd(event.pointerId, endPress)
  press = {
    x: event.clientX,
    y: event.clientY,
    stop,
    timer: setTimeout(() => {
      endPress()
      // The release that follows a long press is not a tap.
      swallowClick = true
      clearTimeout(swallowReset)
      swallowReset = setTimeout(() => { swallowClick = false }, 1000)
      void openMenu()
    }, LONG_PRESS_MS),
  }
}

function onPointerMove(event: PointerEvent): void {
  if (press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > MOVE_TOLERANCE_PX) endPress()
}

function onContextMenu(): void {
  if (!hasMenu.value) return
  endPress()
  swallowClick = true
  void openMenu()
}

function onClick(): void {
  if (swallowClick) {
    swallowClick = false
    return
  }
  if (panel.value !== null) {
    close()
    return
  }
  if (props.status === 'done') emit('clear')
  else emit('record', 'done')
}

function choose(status: ActualStatus): void {
  close(false)
  emit('record', status)
  trigger.value?.focus()
}

function askMinutes(): void {
  minutes.value = props.actualMinutes ?? Math.round((props.plannedMinutes ?? 0) / 2)
  panel.value = 'minutes'
  void nextTick(() => root.value?.querySelector<HTMLInputElement>('input')?.focus())
}

function saveMinutes(): void {
  if (!props.writable || panel.value !== 'minutes' || !minutesInput.value?.reportValidity()) return
  close(false)
  emit('record', 'partial', minutes.value)
  trigger.value?.focus()
}

function clearAnswer(): void {
  close(false)
  emit('clear')
  trigger.value?.focus()
}

// Escape only belongs to the control while its panel is open; otherwise a sheet around it still gets it.
function onEscape(event: KeyboardEvent): void {
  if (panel.value === null) return
  event.stopPropagation()
  close()
}

// Arrows and Tab belong to the minutes field while it is open; they only move through the menu.
function onTab(): void {
  if (panel.value === 'menu') close(false)
}

function move(step: number, event: KeyboardEvent): void {
  if (panel.value !== 'menu') return
  const items = menuItems()
  const at = items.indexOf(document.activeElement as HTMLElement)
  items[(at + step + items.length) % items.length]?.focus()
  event.preventDefault()
}

function onDocumentPointerDown(event: PointerEvent): void {
  if (!root.value?.contains(event.target as Node)) close(false)
}

watch(panel, (value) => {
  if (value) document.addEventListener('pointerdown', onDocumentPointerDown)
  else document.removeEventListener('pointerdown', onDocumentPointerDown)
})
// An open menu or draft belongs to one item and one moment: when the control is reused or locked, it goes.
watch(() => props.itemKey, () => close(false))
watch(() => props.writable, (writable) => { if (!writable) close(false) })
onBeforeUnmount(() => {
  endPress()
  clearTimeout(swallowReset)
  document.removeEventListener('pointerdown', onDocumentPointerDown)
})
</script>

<template>
  <span ref="root" class="status" @keydown.esc="onEscape">
    <button
      ref="trigger"
      type="button"
      class="status-circle"
      :class="`is-${status ?? 'none'}`"
      data-testid="status-control"
      :data-status="status ?? 'none'"
      :aria-label="label"
      :aria-haspopup="hasMenu ? 'menu' : undefined"
      :aria-expanded="hasMenu ? panel !== null : undefined"
      :aria-controls="panel === 'menu' ? menuId : undefined"
      :title="hasMenu && writable ? t('today.status.hint') : undefined"
      :disabled="!writable"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @click="onClick"
      @contextmenu.prevent="onContextMenu"
      @keydown.down.prevent="openMenu"
    >
      <span class="status-ring"><Icon v-if="status === 'done'" name="check" :size="14" /></span>
    </button>
    <!-- One panel whose content swaps from the menu to the minutes editor, so the two never overlap while fading. -->
    <Transition name="status-panel">
      <div
        v-if="panel !== null"
        :id="menuId"
        ref="menu"
        class="panel"
        :class="{ 'is-above': above, minutes: panel === 'minutes' }"
        :role="panel === 'menu' ? 'menu' : 'group'"
        :aria-label="t('today.status.menuLabel', { title })"
        :data-testid="panel === 'menu' ? 'status-menu' : 'status-minutes-panel'"
        @keydown.down="move(1, $event)"
        @keydown.up="move(-1, $event)"
        @keydown.tab="onTab"
      >
        <template v-if="panel === 'menu'">
          <button type="button" role="menuitem" class="menu-item t-body" data-testid="status-partial" @click="askMinutes">{{ t('today.status.partial') }}</button>
          <button type="button" role="menuitem" class="menu-item t-body" data-testid="status-skipped" @click="choose('skipped')">{{ t('today.status.skipped') }}</button>
          <button v-if="status" type="button" role="menuitem" class="menu-item t-body" data-testid="status-clear" @click="clearAnswer">{{ t('today.status.clear') }}</button>
        </template>
        <div v-else class="minutes-form" data-testid="status-minutes" @keydown.enter.stop.prevent="saveMinutes">
          <label class="minutes-label t-footnote" :for="inputId">{{ t('today.status.minutesLabel', { planned: plannedMinutes }) }}</label>
          <div class="minutes-row">
            <input
              :id="inputId"
              ref="minutesInput"
              v-model.number="minutes"
              class="input minutes-input"
              type="number"
              inputmode="numeric"
              min="0"
              :max="plannedMinutes"
              step="5"
            >
            <Button type="button" variant="tinted" @click="saveMinutes">{{ t('today.status.save') }}</Button>
          </div>
        </div>
      </div>
    </Transition>
  </span>
</template>

<style scoped>
.status { position: relative; display: inline-flex; flex: none; }
.status-circle {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--tint-text);
  touch-action: manipulation;
  -webkit-touch-callout: none;
  user-select: none;
}
.status-ring {
  --ring: var(--item-color, var(--block-color, var(--tint)));
  display: grid;
  place-items: center;
  box-sizing: border-box;
  width: 24px;
  height: 24px;
  border: 2px solid var(--ring);
  border-radius: 50%;
  transition: transform 0.1s var(--ease-out), background-color 0.1s;
}
/* Three answers, three shapes: an open ring, a filled disc with a check, a half disc, a ring with a dash. */
.is-done .status-ring { border-color: var(--tint); background: var(--tint); }
.is-partial .status-ring { background: linear-gradient(to right, var(--ring) 50%, transparent 50%); }
.is-skipped .status-ring::after { content: ''; width: 10px; height: 2px; border-radius: 1px; background: var(--ring); }
.status-circle:active:not(:disabled) .status-ring { transform: scale(0.9); }
.status-circle:disabled { opacity: 0.4; cursor: not-allowed; }

.panel {
  position: absolute;
  z-index: 30;
  inset-inline-end: 0;
  top: 100%;
  min-width: 11rem;
  margin-top: var(--space-1);
  padding: var(--space-1);
  border-radius: var(--radius-card);
  background: var(--surface);
  box-shadow: var(--shadow-floating);
  transform-origin: top right;
}
.panel.is-above { top: auto; bottom: 100%; margin: 0 0 var(--space-1); transform-origin: bottom right; }
.menu-item {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: var(--tap-target);
  padding: 0 var(--space-3);
  border: 0;
  border-radius: var(--radius-control);
  background: transparent;
  color: var(--label);
  text-align: start;
  transition: background-color 0.1s;
}
.menu-item:active { background: color-mix(in srgb, var(--label-2) 14%, transparent); }
.menu-item:focus-visible { outline-offset: -2px; }
.panel.minutes { width: max-content; max-width: min(18rem, 80vw); padding: var(--space-3); }
.minutes-form { display: flex; flex-direction: column; gap: var(--space-2); }
.minutes-label { color: var(--label-2); }
.minutes-row { display: flex; align-items: center; gap: var(--space-2); }
.minutes-input { width: 6rem; font-variant-numeric: tabular-nums; }

.status-panel-enter-active, .status-panel-leave-active { transition: opacity 0.15s, transform 0.2s var(--ease-out); }
.status-panel-enter-from, .status-panel-leave-to { opacity: 0; transform: scale(0.96); }
/* Forced palettes drop fills: the answer keeps its shape (ring, filled disc, half disc, dash) in system colours. */
@media (forced-colors: active) {
  .status-circle { outline: none; color: HighlightText; }
  .status-circle:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
  .status-ring { forced-color-adjust: none; border-color: CanvasText; }
  .is-done .status-ring { border-color: Highlight; background: Highlight; }
  .is-partial .status-ring { background: linear-gradient(to right, Highlight 50%, transparent 50%); }
  .is-skipped .status-ring::after { background: CanvasText; }
  .panel { border: 1px solid CanvasText; }
}
@media (prefers-reduced-motion: reduce) {
  .status-circle:active:not(:disabled) .status-ring { transform: none; opacity: 0.6; }
  .status-panel-enter-from, .status-panel-leave-to { transform: none; }
}
</style>
