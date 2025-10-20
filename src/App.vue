<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useWeekStore } from '@/stores/weekStore'
import CategoryManager from '@/components/CategoryManager.vue'
import WeeklyCalendar from '@/components/WeeklyCalendar.vue'
import StatsDashboard from '@/components/StatsDashboard.vue'
import LanguageSelector from '@/components/LanguageSelector.vue'

const { t } = useI18n()

const weekStore = useWeekStore()
const activeTab = ref<'calendar' | 'categories' | 'stats'>('calendar')

// Swipe gesture handling
let touchStartX = 0
let touchEndX = 0

const tabs: Array<'calendar' | 'categories' | 'stats'> = ['calendar', 'categories', 'stats']

function handleTouchStart(e: TouchEvent) {
  touchStartX = e.changedTouches[0].screenX
}

function handleTouchEnd(e: TouchEvent) {
  touchEndX = e.changedTouches[0].screenX
  handleSwipe()
}

function handleSwipe() {
  const swipeThreshold = 50 // minimum distance for swipe
  const currentIndex = tabs.indexOf(activeTab.value)

  // Swipe left - go to next tab
  if (touchStartX - touchEndX > swipeThreshold && currentIndex < tabs.length - 1) {
    activeTab.value = tabs[currentIndex + 1]
  }

  // Swipe right - go to previous tab
  if (touchEndX - touchStartX > swipeThreshold && currentIndex > 0) {
    activeTab.value = tabs[currentIndex - 1]
  }
}

onMounted(() => {
  weekStore.loadFromStorage()
})
</script>

<template>
  <div class="app">
    <header class="app-header">
      <div class="header-content">
        <h1>{{ t('app.title') }}</h1>
        <p class="tagline">{{ t('app.tagline') }}</p>
      </div>
      <div class="header-actions">
        <LanguageSelector />
      </div>
    </header>

    <nav class="app-nav">
      <button
        @click="activeTab = 'calendar'"
        :class="['nav-btn', { active: activeTab === 'calendar' }]"
      >
        📅 {{ t('nav.calendar') }}
      </button>
      <button
        @click="activeTab = 'categories'"
        :class="['nav-btn', { active: activeTab === 'categories' }]"
      >
        🏷️ {{ t('nav.categories') }}
      </button>
      <button
        @click="activeTab = 'stats'"
        :class="['nav-btn', { active: activeTab === 'stats' }]"
      >
        📊 {{ t('nav.statistics') }}
      </button>
    </nav>

    <main
      class="app-main"
      @touchstart="handleTouchStart"
      @touchend="handleTouchEnd"
    >
      <WeeklyCalendar v-show="activeTab === 'calendar'" />
      <CategoryManager v-show="activeTab === 'categories'" />
      <StatsDashboard v-show="activeTab === 'stats'" />
    </main>

    <footer class="app-footer">
      <p>{{ t('footer.text') }}</p>
    </footer>
  </div>
</template>

<style>
/* Global Styles */
* {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial,
    sans-serif;
  background-color: #f9fafb;
  color: #1f2937;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

@media (max-width: 768px) {
  body {
    background-color: #f3f4f6;
  }
}

#app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
</style>

<style scoped>
.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* Header */
.app-header {
  background: linear-gradient(135deg, var(--color-primary-gradient-start) 0%, var(--color-primary-gradient-end) 100%);
  color: white;
  padding: 2rem 1rem;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: visible;
}

.header-content {
  padding: 0 2rem;
  margin: 0 auto;
  text-align: center;
}

.header-actions {
  position: absolute;
  right: 2rem;
  top: 50%;
  transform: translateY(-50%);
}

.header-content h1 {
  font-size: 2.5rem;
  font-weight: 800;
  margin-bottom: 0.5rem;
  letter-spacing: -0.5px;
}

.tagline {
  font-size: 1.125rem;
  opacity: 0.95;
  font-weight: 300;
}

/* Navigation */
.app-nav {
  background: white;
  border-bottom: 1px solid #e5e7eb;
  display: flex;
  justify-content: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
}

.nav-btn {
  padding: 0.75rem 1.5rem;
  border: none;
  background-color: transparent;
  color: var(--color-text-light);
  font-size: 1rem;
  font-weight: 500;
  cursor: pointer;
  border-radius: 0.5rem;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.nav-btn:hover {
  background-color: var(--color-hover-bg);
  color: var(--color-hover-text);
}

.nav-btn.active {
  background-color: var(--color-active-bg);
  color: var(--color-active-text);
}

/* Main Content */
.app-main {
  flex: 1;
  width: 100%;
  overflow-x: hidden;
  position: relative;
}

.app-main > * {
  transition: opacity 0.2s ease-in-out;
}

/* Footer */
.app-footer {
  background-color: #1f2937;
  color: #9ca3af;
  padding: 1.5rem 1rem;
  text-align: center;
  margin-top: auto;
}

.app-footer p {
  font-size: 0.875rem;
}

/* Responsive Design */
@media (max-width: 768px) {
  .app-header {
    padding: 1.25rem 1rem 1rem 1rem;
    padding-top: calc(1.25rem + env(safe-area-inset-top));
  }

  .header-content {
    padding: 0;
  }

  .header-actions {
    right: 1rem;
  }

  .header-content h1 {
    font-size: 1.75rem;
    margin-bottom: 0.25rem;
  }

  .tagline {
    font-size: 0.875rem;
    opacity: 0.9;
  }

  .app-nav {
    gap: 0;
    padding: 0;
    background: white;
    border-bottom: 1px solid #e5e7eb;
  }

  .nav-btn {
    flex: 1;
    justify-content: center;
    padding: 1rem 0.5rem;
    font-size: 0.9375rem;
    border-radius: 0;
    gap: 0.25rem;
    flex-direction: column;
    position: relative;
  }

  .nav-btn::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 3px;
    background: transparent;
    transition: background 0.2s;
  }

  .nav-btn.active::after {
    background: var(--color-active-indicator);
  }

  .nav-btn.active {
    background-color: transparent;
    color: var(--color-active-indicator);
    font-weight: 600;
  }

  .nav-btn:hover {
    background-color: var(--color-hover-bg);
    color: var(--color-hover-text);
  }

  .app-footer {
    padding: 1rem;
    padding-bottom: calc(1rem + env(safe-area-inset-bottom));
  }

  .app-footer p {
    font-size: 0.75rem;
  }
}
</style>
