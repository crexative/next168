<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { fitTitle } from '@/features/week/itemText'

const props = withDefaults(defineProps<{ text: string; lines?: number }>(), { lines: 2 })
const element = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)
const shown = ref(props.text)
let observer: ResizeObserver | undefined

function refresh(): void {
  if (!element.value || !probe.value) return
  const width = element.value.getBoundingClientRect().width
  if (width <= 0) { shown.value = props.text; return }
  const metrics = {
    width(text: string) {
      probe.value!.dataset.word = text
      return probe.value!.getBoundingClientRect().width
    },
    lineHeight: () => 1,
  }
  shown.value = fitTitle({ text: props.text, role: 'caption' }, { width, height: props.lines }, metrics)?.text ?? '…'
}

watch(() => [props.text, props.lines], () => { void nextTick(refresh) })
onMounted(() => {
  refresh()
  if (typeof ResizeObserver !== 'undefined') {
    observer = new ResizeObserver(refresh)
    observer.observe(element.value!)
  }
  window.addEventListener('resize', refresh)
  document.fonts?.addEventListener?.('loadingdone', refresh)
})
onBeforeUnmount(() => {
  observer?.disconnect()
  window.removeEventListener('resize', refresh)
  document.fonts?.removeEventListener?.('loadingdone', refresh)
})
</script>

<template>
  <span ref="element" class="whole-word-text" :aria-label="text" :title="shown !== text ? text : undefined">
    {{ shown }}<span ref="probe" class="word-probe" aria-hidden="true" />
  </span>
</template>

<style scoped>
.whole-word-text { display: block; position: relative; overflow: hidden; min-width: 0; white-space: normal; overflow-wrap: normal; word-break: normal; }
.word-probe { position: absolute; inset: 0 auto auto 0; visibility: hidden; pointer-events: none; white-space: pre; width: max-content; font: inherit; letter-spacing: inherit; }
.word-probe::before { content: attr(data-word); }
</style>
