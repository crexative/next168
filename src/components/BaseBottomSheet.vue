<script setup lang="ts">
import { watch } from 'vue'

interface Props {
  show: boolean
  title: string
  showFooter?: boolean
}

interface Emits {
  (e: 'close'): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const closeBottomSheet = () => {
  emit('close')
}

// Block body scroll when bottom sheet is open
watch(() => props.show, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="bottom-sheet">
      <div v-if="show" class="bottom-sheet-overlay" @click="closeBottomSheet">
        <div class="bottom-sheet" @click.stop>
          <div class="bottom-sheet-handle"></div>
          <div class="bottom-sheet-header">
            <h3>{{ title }}</h3>
            <button class="btn-close" @click="closeBottomSheet">×</button>
          </div>
          <div class="bottom-sheet-body">
            <slot name="body"></slot>
          </div>
          <div v-if="showFooter" class="bottom-sheet-footer">
            <slot name="footer"></slot>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.bottom-sheet-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 1000;
  display: flex;
  align-items: flex-end;
}

.bottom-sheet {
  background: white;
  border-radius: 1.5rem 1.5rem 0 0;
  width: 100%;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 -4px 20px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
}

/* Bottom sheet transition animations */
.bottom-sheet-enter-active,
.bottom-sheet-leave-active {
  transition: opacity 0.3s ease;
}

.bottom-sheet-enter-from,
.bottom-sheet-leave-to {
  opacity: 0;
}

.bottom-sheet-enter-active .bottom-sheet,
.bottom-sheet-leave-active .bottom-sheet {
  transition: transform 0.3s ease-out;
}

.bottom-sheet-enter-from .bottom-sheet,
.bottom-sheet-leave-to .bottom-sheet {
  transform: translateY(100%);
}

.bottom-sheet-handle {
  width: 2.5rem;
  height: 0.25rem;
  background: #d1d5db;
  border-radius: 0.125rem;
  margin: 0.75rem auto 0.5rem;
}

.bottom-sheet-header {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 0 1.25rem 1rem 1.25rem;
  border-bottom: 1px solid #e5e7eb;
  position: relative;
}

.bottom-sheet-header h3 {
  font-size: 1.125rem;
  font-weight: 600;
  color: #1f2937;
  margin: 0;
}

.btn-close {
  background: none;
  border: none;
  font-size: 1.75rem;
  color: #6b7280;
  cursor: pointer;
  padding: 0;
  width: 2rem;
  height: 2rem;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 0.375rem;
  transition: all 0.2s;
  position: absolute;
  right: 1.25rem;
}

.btn-close:hover {
  background-color: #f3f4f6;
  color: #374151;
}

.bottom-sheet-body {
  padding: 1.25rem;
  overflow-y: auto;
  overflow-x: hidden;
  flex: 1;
  padding-bottom: calc(1.25rem + env(safe-area-inset-bottom));
}

.bottom-sheet-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  border-top: 1px solid #e5e7eb;
  background-color: #f9fafb;
}
</style>
