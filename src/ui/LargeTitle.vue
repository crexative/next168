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
      <!-- The tablet's top tab bar: when it shows, it names the page and the collapsed title stays hidden. -->
      <div class="toolbar-center"><slot name="center" /></div>
      <div id="toolbar-actions" class="toolbar-actions"><slot name="actions" /></div>
    </div>
  </header>
  <div class="title-row">
    <!-- Focusable by script only: the shell moves focus here after a route change. -->
    <h1 ref="heading" class="large-title t-large-title" tabindex="-1">{{ title }}</h1>
    <div v-if="$slots.trailing" class="title-trailing"><slot name="trailing" /></div>
  </div>
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
  /* Transparent over the title row: only its own controls take presses. Collapsed, it is a bar of material over the
     page, and the whole bar takes presses so nothing under it is reached (review of #53). */
  pointer-events: none;
}
.toolbar[data-collapsed] { pointer-events: auto; }
.toolbar-center, .toolbar-actions { pointer-events: auto; }
.toolbar[data-collapsed] {
  background: var(--material);
  -webkit-backdrop-filter: var(--material-filter);
  backdrop-filter: var(--material-filter);
}
.toolbar-inner {
  /* Three columns: an empty leading one, the centred tabs (tablet) and the actions. The sides share what the tabs leave,
     and the actions never give up their width, so at large text the tabs move off centre instead of overlapping. */
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(max-content, 1fr);
  column-gap: var(--space-4);
  align-items: center;
  height: var(--toolbar-height);
  padding: 0 var(--page-gutter);
  position: relative;
}
.toolbar-title {
  position: absolute;
  /* Clear of the actions on both sides; at large text sizes it stops growing and truncates. */
  inset-inline: calc(var(--tap-target) * 2 + var(--space-2) + var(--page-gutter));
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
.toolbar-center { grid-column: 2; grid-row: 1; display: flex; justify-content: center; min-width: 0; }
/* A view may place a leading control here (the check-in's back link, teleported in): it takes the leading column. */
.toolbar-inner > :deep(:not(.toolbar-title, .toolbar-center, .toolbar-actions)) { grid-column: 1; grid-row: 1; justify-self: start; pointer-events: auto; }
.toolbar:has(.toolbar-center:not(:empty)) .toolbar-title { display: none; }
.toolbar-actions { grid-column: 3; grid-row: 1; justify-self: end; display: flex; align-items: center; gap: var(--space-2); position: relative; }
/* The collapsed bar ends on a hairline; a page with its own bar under the toolbar draws the edge there instead (base.css). */
.toolbar[data-collapsed] { box-shadow: 0 0.5px 0 var(--material-edge); }
.large-title:focus { outline: none; }
.title-row {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  /* Where the toolbar holds nothing (desktop, sidebar shown) the title takes the toolbar's row: --title-top. */
  padding: var(--title-top, calc(var(--toolbar-height) + var(--space-2))) var(--page-gutter) var(--header-gap);
}
.title-trailing { display: flex; flex: none; align-items: center; min-height: 2.5rem; margin-inline-start: auto; }
.large-title {
  flex: 1;
  min-width: 0;
  /* A long single word ("Tagesabschluss", "Asistente") at 200 % text is hyphenated where the browser can, and
     otherwise breaks, instead of widening the page. */
  overflow-wrap: anywhere;
  hyphens: auto;
}
</style>
