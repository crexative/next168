<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { availableLocales, setLocale } from '@/i18n'

const { locale } = useI18n()
const showDropdown = ref(false)
const buttonRef = ref<HTMLElement | null>(null)
const dropdownStyle = ref({})

const currentLocale = computed(() => {
  const found = availableLocales.find(l => l.code === locale.value)
  return found ?? availableLocales[0] ?? { code: 'en', name: 'English', flag: '🇺🇸' }
})

function updateDropdownPosition() {
  const button = document.querySelector('.language-button') as HTMLElement
  if (button) {
    const rect = button.getBoundingClientRect()
    dropdownStyle.value = {
      position: 'fixed',
      top: `${rect.bottom + 8}px`,
      right: `${window.innerWidth - rect.right}px`,
      left: 'auto'
    }
  }
}

function changeLanguage(code: string) {
  setLocale(code)
  showDropdown.value = false
}

function toggleDropdown() {
  showDropdown.value = !showDropdown.value
  if (showDropdown.value) {
    updateDropdownPosition()
  }
}

onMounted(() => {
  window.addEventListener('resize', updateDropdownPosition)
  window.addEventListener('scroll', updateDropdownPosition)
})

onUnmounted(() => {
  window.removeEventListener('resize', updateDropdownPosition)
  window.removeEventListener('scroll', updateDropdownPosition)
})
</script>

<template>
  <div class="language-selector">
    <button @click="toggleDropdown" class="language-button" aria-label="Select Language">
      <span class="flag">{{ currentLocale.flag }}</span>
      <span class="name">{{ currentLocale.name }}</span>
      <span class="chevron" :class="{ open: showDropdown }">▼</span>
    </button>

    <Teleport to="body">
      <Transition name="dropdown">
        <div v-if="showDropdown" class="dropdown" :style="dropdownStyle">
          <button
            v-for="lang in availableLocales"
            :key="lang.code"
            @click="changeLanguage(lang.code)"
            class="dropdown-item"
            :class="{ active: lang.code === locale }"
          >
            <span class="flag">{{ lang.flag }}</span>
            <span class="name">{{ lang.name }}</span>
          </button>
        </div>
      </Transition>

      <div v-if="showDropdown" class="overlay" @click="showDropdown = false"></div>
    </Teleport>
  </div>
</template>

<style scoped>
.language-selector {
  position: relative;
}

.language-button {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  cursor: pointer;
  font-size: 0.875rem;
  transition: all 0.2s;
}

.language-button:hover {
  background: #f9fafb;
  border-color: #d1d5db;
}

.language-button:active {
  transform: scale(0.98);
}

.language-button .flag {
  font-size: 1.25rem;
}

.language-button .name {
  font-weight: 500;
  color: #374151;
}

.language-button .chevron {
  font-size: 0.625rem;
  color: #6b7280;
  transition: transform 0.2s;
}

.language-button .chevron.open {
  transform: rotate(180deg);
}

.dropdown {
  background: white;
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
  box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05);
  min-width: 150px;
  z-index: 1000;
  overflow: hidden;
}

.dropdown-item {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  background: white;
  border: none;
  cursor: pointer;
  font-size: 0.875rem;
  transition: background 0.2s;
  text-align: left;
}

.dropdown-item:hover {
  background: #f9fafb;
}

.dropdown-item.active {
  background: #eff6ff;
  color: #2563eb;
}

.dropdown-item .flag {
  font-size: 1.25rem;
}

.dropdown-item .name {
  font-weight: 500;
}

.overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
}

/* Dropdown transition */
.dropdown-enter-active,
.dropdown-leave-active {
  transition: opacity 0.2s, transform 0.2s;
}

.dropdown-enter-from,
.dropdown-leave-to {
  opacity: 0;
  transform: translateY(-0.5rem);
}

/* Mobile styles */
@media (max-width: 768px) {
  .language-button .name {
    display: none;
  }

  .language-button {
    padding: 0.5rem;
  }
}
</style>
