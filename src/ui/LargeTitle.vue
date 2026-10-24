<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ title: string }>()

const TOOLBAR_PX = 52
const heading = ref<HTMLElement | null>(null)
const collapsed = ref(false)
let observer: IntersectionObserver | undefined

onMounted(() => {
  if (!heading.value || typeof IntersectionObserver === 'undefined') return
  observer = new IntersectionObserver(([entry]) => {
    collapsed.value = !!entry && !entry.isIntersecting && entry.boundingClientRect.top < TOOLBAR_PX
  }, { rootMargin: `-${TOOLBAR_PX}px 0px 0px 0px` })
  observer.observe(heading.value)
})
onBeforeUnmount(() => observer?.disconnect())
</script>

<template>
  <header class="toolbar" :data-collapsed="collapsed || undefined">
    <div class="toolbar-inner">
      <span class="toolbar-title t-headline" aria-hidden="true">{{ title }}</span>
      <div id="toolbar-actions" class="toolbar-actions"><slot name="actions" /></div>
    </div>
  </header>
  <!-- Focusable by script only: the shell moves focus here after a route change. -->
  <h1 ref="heading" class="large-title t-large-title" tabindex="-1">{{ title }}</h1>
</template>

<style scoped>
.toolbar {
  position: sticky;
  top: 0;
  z-index: 10;
  padding-top: var(--safe-top);
  margin-bottom: calc(var(--toolbar-height) * -1);
  background: transparent;
  transition: background-color 0.15s;
}
.toolbar[data-collapsed] {
  background: var(--material);
  -webkit-backdrop-filter: var(--material-filter);
  backdrop-filter: var(--material-filter);
}
.toolbar-inner {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  height: var(--toolbar-height);
  padding: 0 var(--space-4);
  position: relative;
}
.toolbar-title {
  position: absolute;
  /* Clear of the actions on both sides; at large text sizes it stops growing and truncates. */
  inset-inline: calc(var(--tap-target) * 2 + var(--space-2) + var(--space-4));
  overflow: hidden;
  font-size: min(1.0625rem, 22px);
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
.toolbar[data-collapsed] .toolbar-title { opacity: 1; }
.toolbar-actions { display: flex; align-items: center; gap: var(--space-2); position: relative; }
/* The collapsed bar ends on a hairline; a page with its own bar under the toolbar draws the edge there instead (base.css). */
.toolbar[data-collapsed] { box-shadow: 0 0.5px 0 var(--material-edge); }
.large-title:focus { outline: none; }
.large-title {
  padding: calc(var(--toolbar-height) + var(--space-2)) var(--space-4) var(--space-2);
}
</style>
