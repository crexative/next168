<script setup lang="ts">
import { computed } from 'vue'
import BaseModal from './BaseModal.vue'

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

const typeConfig = computed(() => {
  const configs = {
    danger: {
      icon: '⚠️',
      titleColor: '#dc2626',
      buttonColor: '#dc2626',
      buttonHoverColor: '#b91c1c',
      bgColor: '#fee2e2',
      iconBgColor: '#fecaca'
    },
    warning: {
      icon: '⚠️',
      titleColor: '#d97706',
      buttonColor: '#d97706',
      buttonHoverColor: '#b45309',
      bgColor: '#fef3c7',
      iconBgColor: '#fde68a'
    },
    info: {
      icon: 'ℹ️',
      titleColor: '#2563eb',
      buttonColor: '#2563eb',
      buttonHoverColor: '#1d4ed8',
      bgColor: '#dbeafe',
      iconBgColor: '#bfdbfe'
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
</script>

<template>
  <BaseModal
    :model-value="modelValue"
    :title="title"
    max-width="450px"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <div class="confirm-dialog">
      <div class="icon-container" :style="{ backgroundColor: typeConfig.iconBgColor }">
        <span class="icon">{{ typeConfig.icon }}</span>
      </div>
      <div class="message-container">
        <p class="message">{{ message }}</p>
      </div>
    </div>

    <template #footer>
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
    </template>
  </BaseModal>
</template>

<style scoped>
.confirm-dialog {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1.5rem;
  padding: 1rem 0;
}

.icon-container {
  width: 4rem;
  height: 4rem;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}

.icon {
  font-size: 2rem;
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

/* Buttons */
.btn {
  padding: 0.625rem 1.25rem;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 80px;
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
  .confirm-dialog {
    padding: 0.5rem 0;
    gap: 1rem;
  }

  .icon-container {
    width: 3rem;
    height: 3rem;
  }

  .icon {
    font-size: 1.5rem;
  }

  .message {
    font-size: 0.9375rem;
  }
}
</style>
