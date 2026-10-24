<script setup lang="ts">
import { computed } from 'vue'
import { categoryGlyph, categoryStroke, type CategoryLook } from './categoryVisual'

// A category's glyph (its icon or initial) in a ring of its colour, optionally followed by its name, so a
// category is never told apart by colour alone. The glyph is decorative: the name, visible or in the
// surrounding label, carries the meaning for assistive technology.
const props = defineProps<{ category: CategoryLook | undefined; withName?: boolean }>()

const glyph = computed(() => categoryGlyph(props.category))
const stroke = computed(() => categoryStroke(props.category))
</script>

<template>
  <span class="category-mark" :style="{ '--mark-color': stroke }" data-testid="category-mark">
    <!-- Drawn as generated content so the glyph never becomes part of a control's visible text or accessible name. -->
    <span class="category-glyph" :data-glyph="glyph" aria-hidden="true" />
    <span v-if="withName && category" class="category-name">{{ category.name }}</span>
  </span>
</template>

<style scoped>
.category-mark { display: inline-flex; align-items: center; gap: 0.375em; min-width: 0; max-width: 100%; vertical-align: middle; }
.category-glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 1.5em;
  height: 1.5em;
  border: 1.5px solid var(--mark-color);
  border-radius: 50%;
  background: color-mix(in srgb, var(--mark-color) 14%, var(--surface));
  color: var(--label);
  font-size: 0.75em;
  font-weight: 700;
  line-height: 1;
  letter-spacing: 0;
}
.category-glyph::before { content: attr(data-glyph); }
.category-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
@media (forced-colors: active) {
  .category-glyph { border-color: CanvasText; }
}
</style>
