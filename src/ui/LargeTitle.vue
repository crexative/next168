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
  <h1 ref="heading" class="large-title t-large-title">{{ title }}</h1>
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
  inset-inline: 0;
  text-align: center;
  opacity: 0;
  transition: opacity 0.15s;
  pointer-events: none;
}
.toolbar[data-collapsed] .toolbar-title { opacity: 1; }
.toolbar-actions { display: flex; align-items: center; gap: var(--space-2); position: relative; }
.toolbar::after {
  content: '';
  position: absolute;
  inset-inline: 0;
  top: 100%;
  height: 12px;
  background: linear-gradient(var(--material), transparent);
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}
.toolbar[data-collapsed]::after { opacity: 0.5; }
.large-title {
  padding: calc(var(--toolbar-height) + var(--space-2)) var(--space-4) var(--space-2);
}
</style>
