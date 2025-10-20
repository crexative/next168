<script setup lang="ts">
import { computed, watch } from 'vue'

type DialogType = 'danger' | 'warning' | 'info'

interface Props {
  modelValue: boolean
  title?: string
  message: string
  confirmText?: string
  cancelText?: string
  type?: DialogType
}

interface Emits {
  (e: 'update:modelValue', value: boolean): void
  (e: 'confirm'): void
  (e: 'cancel'): void
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Confirm Action',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  type: 'warning'
})

const emit = defineEmits<Emits>()

// Block body scroll when dialog is open
watch(() => props.modelValue, (isOpen) => {
  if (isOpen) {
    document.body.style.overflow = 'hidden'
  } else {
    document.body.style.overflow = ''
  }
})

const typeConfig = computed(() => {
  const configs = {
    danger: {
      iconColor: '#dc2626',
      titleColor: '#dc2626',
      buttonColor: '#dc2626',
      buttonHoverColor: '#b91c1c',
      bgColor: '#fee2e2',
      iconBgColor: '#fef2f2'
    },
    warning: {
      iconColor: '#d97706',
      titleColor: '#d97706',
      buttonColor: '#d97706',
      buttonHoverColor: '#b45309',
      bgColor: '#fef3c7',
      iconBgColor: '#fffbeb'
    },
    info: {
      iconColor: '#2563eb',
      titleColor: '#2563eb',
      buttonColor: '#2563eb',
      buttonHoverColor: '#1d4ed8',
      bgColor: '#dbeafe',
      iconBgColor: '#eff6ff'
    }
  }
  return configs[props.type]
})

function handleConfirm() {
  emit('confirm')
  emit('update:modelValue', false)
}

function handleCancel() {
  emit('cancel')
  emit('update:modelValue', false)
}

function closeDialog() {
  emit('update:modelValue', false)
  emit('cancel')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="modal-fade">
      <div v-if="modelValue" class="confirm-overlay" @click="closeDialog">
        <Transition name="modal-scale">
          <div v-if="modelValue" class="confirm-modal" @click.stop>
            <div class="confirm-header">
              <h3>{{ title }}</h3>
              <button class="btn-close" @click="closeDialog" aria-label="Close">×</button>
            </div>

            <div class="confirm-dialog">
              <div class="icon-container" :style="{ backgroundColor: typeConfig.iconBgColor }">
                <svg class="icon-svg" :style="{ color: typeConfig.iconColor }" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 9V11M12 15H12.01M5.07183 19H18.9282C20.4678 19 21.4301 17.3333 20.6603 16L13.7321 4C12.9623 2.66667 11.0377 2.66667 10.2679 4L3.33975 16C2.56995 17.3333 3.53223 19 5.07183 19Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </div>
              <div class="message-container">
                <p class="message">{{ message }}</p>
              </div>
            </div>

            <div class="confirm-footer">
              <button
                class="btn btn-secondary"
                type="button"
                @click="handleCancel"
              >
                {{ cancelText }}
              </button>
              <button
                class="btn btn-confirm"
                type="button"
                :style="{
                  backgroundColor: typeConfig.buttonColor,
                  '--hover-color': typeConfig.buttonHoverColor
                }"
                @click="handleConfirm"
              >
                {{ confirmText }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* Overlay with very high z-index */
.confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 9999;
  padding: 1rem;
}

/* Modal container */
.confirm-modal {
  background: white;
  border-radius: 1rem;
  width: 90%;
  max-width: 450px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* Header */
.confirm-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1.5rem;
  border-bottom: 1px solid #e5e7eb;
}

.confirm-header h3 {
  font-size: 1.25rem;
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
  line-height: 1;
}

.btn-close:hover {
  background-color: #f3f4f6;
  color: #374151;
}

/* Transitions */
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.2s ease;
}

.modal-fade-enter-from,
.modal-fade-leave-to {
  opacity: 0;
}

.modal-scale-enter-active {
  transition: all 0.2s ease;
}

.modal-scale-leave-active {
  transition: all 0.15s ease;
}

.modal-scale-enter-from {
  opacity: 0;
  transform: scale(0.9);
}

.modal-scale-leave-to {
  opacity: 0;
  transform: scale(0.95);
}

/* Dialog content */
.confirm-dialog {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 2rem 1.5rem;
}

.icon-container {
  width: 5rem;
  height: 5rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}

.icon-svg {
  width: 3rem;
  height: 3rem;
}

.message-container {
  text-align: center;
  max-width: 100%;
}

.message {
  margin: 0;
  font-size: 1rem;
  line-height: 1.5;
  color: #374151;
}

/* Footer */
.confirm-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1.25rem 1.5rem;
  border-top: 1px solid #e5e7eb;
  background-color: #f9fafb;
}

/* Buttons */
.btn {
  padding: 0.625rem 1.5rem;
  border: none;
  border-radius: 0.5rem;
  font-size: 0.9375rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 90px;
}

.btn:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.btn-secondary {
  background: #f3f4f6;
  color: #374151;
}

.btn-secondary:hover {
  background: #e5e7eb;
}

.btn-confirm {
  color: white;
}

.btn-confirm:hover {
  background-color: var(--hover-color) !important;
}

/* Responsive */
@media (max-width: 640px) {
  .confirm-overlay {
    padding: 0.5rem;
  }

  .confirm-modal {
    max-width: 100%;
  }

  .confirm-header {
    padding: 1.25rem;
  }

  .confirm-header h3 {
    font-size: 1.125rem;
  }

  .confirm-dialog {
    padding: 1.5rem 1rem;
    gap: 1rem;
  }

  .icon-container {
    width: 4rem;
    height: 4rem;
  }

  .icon-svg {
    width: 2.5rem;
    height: 2.5rem;
  }

  .message {
    font-size: 0.9375rem;
  }

  .confirm-footer {
    padding: 1rem 1.25rem;
    flex-direction: column-reverse;
  }

  .btn {
    width: 100%;
  }
}
</style>
