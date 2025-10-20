# UI Component Library

A clean, reusable UI component library for the Weekly Time Manager app.

## Components

### BaseModal

A reusable modal component with smooth animations and accessibility features.

**Props:**
- `modelValue` (boolean, required) - Controls modal visibility (use with v-model)
- `title` (string, optional) - Modal title
- `maxWidth` (string, default: '500px') - Maximum width of the modal

**Slots:**
- `default` - Main content area
- `footer` - Footer area for action buttons

**Features:**
- Click outside to close
- ESC key to close
- Smooth fade animation
- Responsive design
- Body scroll lock when open
- Focus trap

**Usage:**
```vue
<script setup>
import { ref } from 'vue'
import { BaseModal } from '@/components/ui'

const showModal = ref(false)
</script>

<template>
  <BaseModal v-model="showModal" title="My Modal" max-width="600px">
    <p>Modal content goes here</p>

    <template #footer>
      <button @click="showModal = false">Close</button>
    </template>
  </BaseModal>
</template>
```

---

### ConfirmDialog

A reusable confirmation dialog built on top of BaseModal.

**Props:**
- `modelValue` (boolean, required) - Controls dialog visibility (use with v-model)
- `title` (string, default: 'Confirm Action') - Dialog title
- `message` (string, required) - Confirmation message
- `confirmText` (string, default: 'Confirm') - Confirm button text
- `cancelText` (string, default: 'Cancel') - Cancel button text
- `type` ('danger' | 'warning' | 'info', default: 'warning') - Dialog type affecting colors

**Emits:**
- `update:modelValue` - Emitted when dialog is closed
- `confirm` - Emitted when user confirms
- `cancel` - Emitted when user cancels

**Features:**
- Three visual variants (danger, warning, info)
- Automatic close on confirm/cancel
- Icon-based visual feedback
- Clean, modern design

**Usage:**
```vue
<script setup>
import { ref } from 'vue'
import { ConfirmDialog } from '@/components/ui'

const showConfirm = ref(false)

function handleDelete() {
  showConfirm.value = true
}

function onConfirm() {
  // Perform delete action
  console.log('Confirmed!')
}
</script>

<template>
  <ConfirmDialog
    v-model="showConfirm"
    type="danger"
    title="Delete Item"
    message="Are you sure you want to delete this item? This action cannot be undone."
    confirm-text="Delete"
    cancel-text="Cancel"
    @confirm="onConfirm"
  />
</template>
```

---

## Design Principles

1. **Reusability**: Components are designed to be used throughout the app
2. **Composition**: Components can be composed together (e.g., ConfirmDialog uses BaseModal)
3. **Accessibility**: Keyboard navigation, ARIA labels, focus management
4. **Responsiveness**: Mobile-first design that works on all screen sizes
5. **TypeScript**: Full type safety with TypeScript
6. **Modern**: Vue 3 Composition API with `<script setup>`

## Color Palette

The components use a consistent color system:

- **Primary**: `#3b82f6` (Blue)
- **Danger**: `#dc2626` (Red)
- **Warning**: `#d97706` (Amber)
- **Info**: `#2563eb` (Blue)
- **Gray Scale**: `#1f2937`, `#374151`, `#6b7280`, `#d1d5db`, `#e5e7eb`, `#f3f4f6`, `#f9fafb`

## Best Practices

1. Always use `v-model` for modal visibility
2. Provide descriptive titles and messages
3. Use appropriate dialog types (danger for destructive actions)
4. Handle confirm/cancel events appropriately
5. Consider mobile users with touch-friendly sizes

## Future Components

Potential additions to the component library:
- `BaseButton` - Reusable button with variants
- `BaseInput` - Styled form input
- `BaseSelect` - Dropdown select
- `Toast` - Notification toast
- `LoadingSpinner` - Loading indicator
- `EmptyState` - Empty state placeholder
