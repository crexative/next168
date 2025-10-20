<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'

interface Props {
  modelValue: boolean
  title?: string
  maxWidth?: string
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
}

const props = withDefaults(defineProps<Props>(), {
  title: '',
  maxWidth: '500px'
})

const emit = defineEmits<Emits>()

function close() {
  emit('update:modelValue', false)
}

function handleEscape(event: KeyboardEvent) {
  if (event.key === 'Escape' && props.modelValue) {
    close()
  }
}

watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

onMounted(() => {
  document.addEventListener('keydown', handleEscape)
})

onUnmounted(() => {
  document.removeEventListener('keydown', handleEscape)
  document.body.style.overflow = ''
})
</script>

<template>
  <Transition name="modal-fade">
    <div
      v-if="modelValue"
      class="modal-overlay"
      @click="close"
    >
      <div
        class="modal"
        :style="{ maxWidth }"
        @click.stop
      >
        <div class="modal-header">
          <h3 v-if="title" class="modal-title">{{ title }}</h3>
          <button
            class="btn-close"
            type="button"
            aria-label="Close modal"
            @click="close"
          >
            ×
          </button>
        </div>

        <div class="modal-body">
          <slot />
        </div>

        <div v-if="$slots.footer" class="modal-footer">
          <slot name="footer" />
        </div>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 1rem;
}

.modal {
  background: white;
  border-radius: 0.5rem;
  width: 100%;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.25rem;
  border-bottom: 1px solid #e5e7eb;
}

.modal-title {
  margin: 0;
  font-size: 1.25rem;
  font-weight: 600;
  color: #1f2937;
}

.btn-close {
  background: none;
  border: none;
  font-size: 2rem;
  cursor: pointer;
  color: #6b7280;
  line-height: 1;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  transition: all 0.2s;
}

.btn-close:hover {
  color: #1f2937;
  background: #f3f4f6;
}

.btn-close:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.modal-body {
  padding: 1.25rem;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1.25rem;
  border-top: 1px solid #e5e7eb;
  background: #f9fafb;
}

/* Fade animation */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-fade-enter-active .modal,
.modal-fade-leave-active .modal {
  transition: transform 0.2s ease, opacity 0.2s ease;
}

.modal-fade-enter-from .modal,
.modal-fade-leave-to .modal {
  transform: scale(0.95);
  opacity: 0;
}

/* Responsive */
@media (max-width: 640px) {
  .modal-overlay {
    padding: 0;
    align-items: flex-end;
  }

  .modal {
    border-radius: 0.5rem 0.5rem 0 0;
    max-height: 95vh;
  }

  .modal-header,
  .modal-body,
  .modal-footer {
    padding: 1rem;
  }
}
</style>
