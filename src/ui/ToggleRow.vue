<script setup lang="ts">
// A settings-style row with an on/off switch: the whole row is the label, so a tap anywhere toggles it.
defineProps<{ label: string; testId?: string }>()
const model = defineModel<boolean>({ required: true })
</script>

<template>
  <li class="toggle-row">
    <label class="row">
      <span class="t-body row-label">{{ label }}</span>
      <input v-model="model" class="switch" type="checkbox" role="switch" :aria-checked="model" :data-testid="testId">
    </label>
  </li>
</template>

<style scoped>
.row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  min-height: max(var(--tap-target), var(--row-min-height));
  padding: var(--row-padding-block) var(--card-padding);
  cursor: pointer;
}
.row-label { flex: 1 1 auto; min-width: 0; overflow-wrap: break-word; }
/* The platform switch: a 51 × 31 track and a 27 px knob, tinted when on. */
.switch {
  appearance: none;
  position: relative;
  flex: none;
  width: 51px;
  height: 31px;
  margin: 0;
  border-radius: 16px;
  background: color-mix(in srgb, var(--label-2) 30%, transparent);
  cursor: pointer;
  transition: background-color 0.2s var(--ease-out);
}
.switch::before {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  background: #ffffff;
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.15), 0 1px 1px rgba(0, 0, 0, 0.16);
  transition: transform 0.2s var(--ease-out);
}
.switch:checked { background: var(--tint); }
.switch:checked::before { transform: translateX(20px); }
.switch:focus-visible { outline: 2px solid var(--tint-label); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  .switch, .switch::before { transition: none; }
}
@media (forced-colors: active) {
  .switch { border: 1px solid ButtonText; }
  .switch::before { background: ButtonText; }
  .switch:checked { background: Highlight; }
}
</style>
