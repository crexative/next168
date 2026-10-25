<script setup lang="ts">
import { nextTick, onMounted, ref, useId, watch } from 'vue'
import { MAX_NAME_LENGTH } from '../setupModel'

// A name the person types: a field that grows to show every character of a long name instead of hiding it, and
// Enter confirms instead of starting a new line.
defineProps<{ label: string; placeholder?: string; invalid?: boolean; testId?: string }>()
const model = defineModel<string>({ required: true })
const emit = defineEmits<{ enter: [] }>()
const id = useId()
const field = ref<HTMLTextAreaElement | null>(null)

function fit(): void {
  const element = field.value
  if (!element) return
  element.style.height = 'auto'
  element.style.height = `${element.scrollHeight}px`
}

function onInput(event: Event): void {
  // A pasted line break is not part of a name.
  model.value = (event.target as HTMLTextAreaElement).value.replace(/[\r\n]+/g, ' ').slice(0, MAX_NAME_LENGTH)
  void nextTick(fit)
}

watch(model, () => void nextTick(fit))
onMounted(fit)
defineExpose({ focus: () => field.value?.focus() })
</script>

<template>
  <div class="name-field">
    <label class="t-body" :for="id">{{ label }}</label>
    <textarea
      :id="id" ref="field" class="input" rows="1" :maxlength="MAX_NAME_LENGTH" autocomplete="off" :value="model" :placeholder="placeholder"
      :aria-invalid="invalid ? true : undefined" :data-testid="testId" enterkeyhint="done"
      @input="onInput" @keydown.enter.prevent="emit('enter')"
    />
  </div>
</template>

<style scoped>
.name-field { display: flex; flex-direction: column; gap: var(--space-1); width: 100%; }
/* One line high, growing line by line; never a scrollbar and never a clipped name. */
textarea {
  display: block; width: 100%; min-height: var(--tap-target); padding-block: var(--space-2); resize: none; overflow: hidden;
  font: inherit; line-height: 1.35; overflow-wrap: anywhere;
}
</style>
