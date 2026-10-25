<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { ELLIPSIS, fitTitle } from '@/features/week/itemText'

const props = withDefaults(defineProps<{ text: string; lines?: number }>(), { lines: 2 })
const element = ref<HTMLElement | null>(null)
const probe = ref<HTMLElement | null>(null)
const hyphenProbe = ref<HTMLElement | null>(null)
const { locale } = useI18n()
const shown = ref(props.text)
// A shortened title is hidden from assistive technology, which reads the full title from its own element instead.
// How the drawn text breaks: between whole words, hyphenated inside a first word wider than a line, or (when the
// language has no hyphenation for it) the whole title broken anywhere and cut by its line box, never as a bare "…".
const mode = ref<'words' | 'hyphenated' | 'anywhere'>('words')
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
    hyphenatedLines,
  }
  const fit = fitTitle({ text: props.text, role: 'caption' }, { width, height: props.lines }, metrics)
  shown.value = fit?.text ?? props.text
  mode.value = !fit ? 'anywhere' : fit.hyphenated ? 'hyphenated' : 'words'
}

// Lines `text` takes at `width` px when the browser hyphenates it in the page's language, or null when a line still
// overflows. Drawn as the view draws it: the words, then "…" in an element of its own.
function hyphenatedLines(text: string, _role: unknown, width: number): number | null {
  const target = hyphenProbe.value
  if (!target) return null
  target.style.width = `${width}px`
  const fill = (content: string) => {
    const cut = content.endsWith(ELLIPSIS)
    const body = document.createTextNode(cut ? content.slice(0, -ELLIPSIS.length) : content)
    if (!cut) { target.replaceChildren(body); return }
    const mark = document.createElement('span')
    mark.textContent = ELLIPSIS
    target.replaceChildren(body, mark)
  }
  fill('A')
  const lineHeight = target.getBoundingClientRect().height
  fill(text)
  if (target.scrollWidth > target.clientWidth + 0.5 || !(lineHeight > 0)) return null
  return Math.round(target.getBoundingClientRect().height / lineHeight)
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
  <span
    ref="element"
    class="whole-word-text"
    :class="`whole-word-${mode}`"
    :lang="locale"
    :title="shown !== text ? text : undefined"
    :style="mode === 'anywhere' ? { maxHeight: `${lines}lh` } : undefined"
  >
    <span class="whole-word-shown" :aria-hidden="shown !== text ? 'true' : undefined">{{ shown.endsWith('…') ? shown.slice(0, -1) : shown }}<span v-if="shown.endsWith('…')">…</span></span>
    <span v-if="shown !== text" class="whole-word-full">{{ text }}</span>
    <span ref="probe" class="word-probe" aria-hidden="true" />
    <span ref="hyphenProbe" class="hyphen-probe" aria-hidden="true" />
  </span>
</template>

<style scoped>
.whole-word-text { display: block; position: relative; overflow: hidden; min-width: 0; white-space: normal; overflow-wrap: normal; word-break: normal; }
.whole-word-hyphenated { hyphens: auto; }
.whole-word-anywhere { overflow-wrap: anywhere; }
.whole-word-full { position: absolute; width: 1px; height: 1px; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.word-probe { position: absolute; inset: 0 auto auto 0; visibility: hidden; pointer-events: none; white-space: pre; width: max-content; font: inherit; letter-spacing: inherit; }
.word-probe::before { content: attr(data-word); }
.hyphen-probe { position: absolute; inset: 0 auto auto 0; visibility: hidden; pointer-events: none; display: block; overflow: hidden; white-space: normal; overflow-wrap: normal; hyphens: auto; font: inherit; letter-spacing: inherit; }
</style>
