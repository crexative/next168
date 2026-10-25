<script setup lang="ts">
import { computed, onMounted, ref, useId } from 'vue'
import Button from '@/ui/Button.vue'
import { useSetupFormat } from './useSetupFormat'

// The frame every question shares: Back, which part of five, one bubble, an optional hint, the answer, and a footer
// that stays in view with at most one primary button.
const props = defineProps<{
  title: string
  hint?: string
  part: number
  total: number
  canBack: boolean
  primary?: string
  secondary?: string
  busy?: boolean
}>()
const emit = defineEmits<{ back: []; primary: []; secondary: [] }>()
const { t } = useSetupFormat()
const heading = ref<HTMLElement | null>(null)
const progressId = useId()
const dots = computed(() => Array.from({ length: props.total }, (_, index) => index < props.part))

// On every screen change, focus goes to the question, which is then read together with its progress.
onMounted(() => heading.value?.focus({ preventScroll: true }))
</script>

<template>
  <section class="screen" :aria-busy="busy || undefined">
    <header class="top">
      <Button v-if="canBack" variant="plain" class="back" data-testid="setup-back" :disabled="busy" @click="emit('back')">‹ {{ t('onboarding.guided.back') }}</Button>
      <span v-else class="back" />
      <p :id="progressId" class="progress t-subhead">
        {{ t('onboarding.guided.progress', { step: part, total }) }}
        <span class="dots" aria-hidden="true"><span v-for="(on, index) in dots" :key="index" class="dot" :class="{ on }" /></span>
      </p>
    </header>
    <div class="bubble"><h3 ref="heading" class="t-title-2" tabindex="-1" :aria-describedby="progressId">{{ title }}</h3></div>
    <p v-if="hint" class="hint t-body">{{ hint }}</p>
    <slot name="banner" />
    <div class="answer"><slot /></div>
    <footer v-if="primary || secondary" class="footer">
      <Button v-if="secondary" variant="plain" data-testid="setup-secondary" :disabled="busy" @click="emit('secondary')">{{ secondary }}</Button>
      <Button v-if="primary" data-primary data-testid="setup-primary" :disabled="busy" @click="emit('primary')">{{ primary }}</Button>
    </footer>
  </section>
</template>

<style scoped>
.screen { display: flex; flex-direction: column; gap: var(--space-3); min-height: 100%; hyphens: auto; }
/* Long words in text may break with a hyphen; a button's words stay whole. */
.screen :deep(button) { hyphens: manual; }
.top { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--space-2); min-height: var(--tap-target); }
.back { flex: none; min-width: var(--tap-target); }
.progress { margin-inline-start: auto; }
.progress { display: flex; align-items: center; gap: var(--space-2); margin: 0; color: var(--label-2); }
.dots { display: inline-flex; gap: 4px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--label-3); }
.dot.on { background: var(--tint); }
/* A bubble: the question, big, in a rounded surface with a small leading corner. */
.bubble { padding: var(--space-3) var(--space-4); border-radius: 18px 18px 18px 6px; background: var(--surface-2); }
.bubble h3 { margin: 0; overflow-wrap: anywhere; outline: none; }
.hint { margin: 0; color: var(--label-2); }
.answer { display: flex; flex-direction: column; gap: var(--space-3); }
/* Sticky at the bottom of the one scroller, so the main button is in view at any text size. */
.footer {
  position: sticky; bottom: calc(var(--space-4) * -1); z-index: 1; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: var(--space-2);
  /* The bar bleeds to the sheet's edges; its buttons keep the sheet's own 16 px inset below them (the edge rule). */
  margin: auto calc(var(--space-4) * -1) calc(var(--space-4) * -1); padding: var(--space-2) var(--space-4) calc(var(--space-4) + var(--safe-bottom));
  background: var(--surface); border-top: 0.5px solid var(--separator);
}
/* At 200 % text a long German label breaks inside the button rather than spilling past it. */
.footer :deep(.ui-button) { overflow-wrap: anywhere; hyphens: auto; }
</style>
