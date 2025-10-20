<script setup lang="ts">
interface Props {
  modelValue: string // Format: "HH:mm" (24-hour)
  label?: string
  id?: string
}

interface Emits {
  (e: 'update:modelValue', value: string): void
}

defineProps<Props>()
const emit = defineEmits<Emits>()

const handleInput = (event: Event) => {
  const value = (event.target as HTMLInputElement).value
  emit('update:modelValue', value)
}
</script>

<template>
  <div class="time-picker">
    <label v-if="label" :for="id" class="time-picker-label">{{ label }}</label>
    <input
      :id="id"
      :value="modelValue"
      type="time"
      class="time-input"
      @input="handleInput"
    />
  </div>
</template>

<style scoped>
.time-picker {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.time-picker-label {
  display: block;
  font-weight: 500;
  color: #374151;
  font-size: 0.875rem;
}

.time-input {
  width: 100%;
  padding: 0.5rem;
  border: 1px solid #d1d5db;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-family: inherit;
}

.time-input:focus {
  outline: none;
  border-color: #3b82f6;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}
</style>
