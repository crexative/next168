<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import Icon from '@/ui/Icon.vue'
import LargeTitle from '@/ui/LargeTitle.vue'
import UndoToast from '@/ui/UndoToast.vue'
import { usePlannerStore } from '@/stores/plannerStore'
import RecoveryScreen from './RecoveryScreen.vue'
import StorageErrorScreen from './StorageErrorScreen.vue'
import StatusBanners from './StatusBanners.vue'
import { shell } from './registry'
import { useHashRoute, viewHash } from './useHashRoute'

const { t } = useI18n()
const planner = usePlannerStore()
const { views, tabs } = shell

const { current } = useHashRoute(() => new Set(views.keys()))
const currentView = computed(() => views.get(current.value) ?? views.get('today'))
const settingsView = computed(() => views.get('settings'))

// A tab opens at its top: the previous view's offset would otherwise be clamped to whatever the new view allows.
function scrollToTop(): void { window.scrollTo({ top: 0, behavior: 'instant' }) }
</script>

<template>
  <div class="shell">
    <nav class="sidebar" :aria-label="t('app.navigation.sidebar')">
      <p class="sidebar-brand t-title-2">{{ t('app.name') }}</p>
      <ul class="sidebar-list">
        <li v-for="tab in tabs" :key="tab.id">
          <a class="sidebar-item t-body" :href="viewHash(tab.id)" :aria-current="current === tab.id ? 'page' : undefined">
            <Icon :name="tab.icon ?? ''" :size="22" />
            {{ t(tab.titleKey) }}
          </a>
        </li>
      </ul>
      <a
        v-if="settingsView"
        class="sidebar-item sidebar-settings t-body"
        :href="viewHash('settings')"
        :aria-current="current === 'settings' ? 'page' : undefined"
      >
        <Icon :name="settingsView.icon ?? 'settings'" :size="22" />
        {{ t(settingsView.titleKey) }}
      </a>
    </nav>

    <div class="content">
      <StatusBanners />
      <main id="main" class="main" tabindex="-1">
        <RecoveryScreen v-if="planner.status === 'corrupt'" />
        <StorageErrorScreen v-else-if="planner.status === 'error'" />
        <Transition v-else name="view" mode="out-in" @after-leave="scrollToTop">
          <div v-if="currentView" :key="currentView.id" class="view">
            <LargeTitle :title="t(currentView.titleKey)">
              <template #actions>
                <a
                  v-if="settingsView"
                  class="gear"
                  :href="viewHash('settings')"
                  :aria-label="t(settingsView.titleKey)"
                  :aria-current="current === 'settings' ? 'page' : undefined"
                >
                  <Icon name="settings" :size="24" />
                </a>
              </template>
            </LargeTitle>
            <component :is="currentView.component" />
          </div>
        </Transition>
      </main>
    </div>

    <nav class="tabbar" :aria-label="t('app.navigation.tabs')">
      <a
        v-for="tab in tabs"
        :key="tab.id"
        class="tabbar-item t-caption"
        :href="viewHash(tab.id)"
        :aria-current="current === tab.id ? 'page' : undefined"
      >
        <Icon :name="tab.icon ?? ''" :size="24" />
        <span>{{ t(tab.titleKey) }}</span>
      </a>
    </nav>
    <UndoToast />
  </div>
</template>

<style scoped>
.shell { min-height: 100dvh; padding-inline: var(--safe-left) var(--safe-right); }
/* --banners-height is the height of the fixed bottom notices (StatusBanners), so none of them covers the end of a page. */
.content { padding-bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--space-4) + var(--banners-height, 0px)); }
.main { max-width: 1200px; margin-inline: auto; outline: none; }

.tabbar {
  position: fixed;
  inset: auto 0 0;
  z-index: 20;
  display: flex;
  height: calc(var(--tabbar-height) + var(--safe-bottom));
  padding: 0 var(--safe-right) var(--safe-bottom) var(--safe-left);
  background: var(--material);
  -webkit-backdrop-filter: var(--material-filter);
  backdrop-filter: var(--material-filter);
  border-top: 0.5px solid var(--separator);
}
.tabbar-item {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  min-height: var(--tap-target);
  color: var(--label-2);
  text-decoration: none;
  transition: transform 0.1s var(--ease-out);
  touch-action: manipulation;
}
.tabbar-item:active { transform: scale(0.97); }
.tabbar-item[aria-current='page'] { color: var(--tint-label); }

.gear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  color: var(--tint-label);
}

.sidebar { display: none; }
.sidebar-item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  min-height: var(--tap-target);
  padding: 0 var(--space-3);
  border-radius: var(--radius-control);
  color: var(--label);
  text-decoration: none;
}
.sidebar-item[aria-current='page'] { background: color-mix(in srgb, var(--tint) 14%, transparent); color: var(--tint-label); font-weight: 600; }
.sidebar-item:hover { background: color-mix(in srgb, var(--label-2) 12%, transparent); }

.view-enter-active, .view-leave-active { transition: opacity 0.15s; }
.view-enter-from, .view-leave-to { opacity: 0; }

@media (min-width: 1024px) {
  .tabbar, .gear { display: none; }
  .content { margin-inline-start: var(--sidebar-width); padding-bottom: calc(var(--space-8) + var(--banners-height, 0px)); }
  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: var(--sidebar-width);
    padding: calc(var(--safe-top) + var(--space-6)) var(--space-3) calc(var(--safe-bottom) + var(--space-4)) calc(var(--safe-left) + var(--space-3));
    background: var(--material);
    -webkit-backdrop-filter: var(--material-filter);
    backdrop-filter: var(--material-filter);
    border-inline-end: 0.5px solid var(--separator);
  }
  .sidebar-brand { padding: 0 var(--space-3) var(--space-3); }
  .sidebar-list { display: flex; flex-direction: column; gap: 2px; }
  .sidebar-settings { margin-top: auto; }
}
</style>
