<script setup lang="ts">
import { anyFullScreenOpen, anyModalOpen } from '@/ui/sheetStack'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { PanelLeft } from 'lucide-vue-next'
import BrandLockup from '@/ui/BrandLockup.vue'
import Icon from '@/ui/Icon.vue'
import { registerIcons } from '@/ui/icons'
import LargeTitle from '@/ui/LargeTitle.vue'
import LiveAnnouncer from '@/ui/LiveAnnouncer.vue'
import UndoToast from '@/ui/UndoToast.vue'
import { announce } from '@/ui/announcer'
import { dismissUndoWhenChanged } from '@/ui/undoToast'
import { useMediaQuery } from '@/ui/useMediaQuery'
import { usePlannerStore } from '@/stores/plannerStore'
import RecoveryScreen from './RecoveryScreen.vue'
import StorageErrorScreen from './StorageErrorScreen.vue'
import StorageUpgradeWaiting from './StorageUpgradeWaiting.vue'
import { UPGRADE_COPY_FAILED } from '@/repositories/storageVersion'
import StatusBanners from './StatusBanners.vue'
import { SHELL_TOOLBAR_ENTRIES } from './contracts'
import { shell } from './registry'
import { isApplePlatform, isSidebarShortcut, layoutFor, OVERLAY_QUERY, PERSISTENT_QUERY, useSidebar } from './sidebar'
import { useHashRoute, viewHash } from './useHashRoute'

registerIcons({ 'panel-left': PanelLeft })

const { t } = useI18n()
const planner = usePlannerStore()
const { views, tabs } = shell

const { current } = useHashRoute(() => new Set(views.keys()))
const currentView = computed(() => views.get(current.value) ?? views.get('today'))
const settingsView = computed(() => views.get('settings'))
const assistantView = computed(() => views.get('assistant'))
// The assistant and Settings, in this order, wherever they appear: every toolbar and the sidebar footer.
const entries = computed(() => [
  assistantView.value && { id: 'assistant' as const, icon: assistantView.value.icon ?? 'sparkles', title: t(assistantView.value.titleKey), label: t('common.askAssistant'), testId: 'assistant-entry' },
  settingsView.value && { id: 'settings' as const, icon: settingsView.value.icon ?? 'settings', title: t(settingsView.value.titleKey), label: t(settingsView.value.titleKey), testId: 'settings-entry' },
].filter((entry) => !!entry))
provide(SHELL_TOOLBAR_ENTRIES, true)

// One readable measure (720 px) for every screen; Week alone takes the full width for its grid.
const FULL_WIDTH_VIEWS: ReadonlySet<string> = new Set(['week'])

const atLeastTablet = useMediaQuery(OVERLAY_QUERY)
const atLeastDesktop = useMediaQuery(PERSISTENT_QUERY)
const layout = computed(() => layoutFor(atLeastTablet.value, atLeastDesktop.value))
const sidebar = useSidebar(layout)
const sidebarVisible = sidebar.visible
// A persistent, visible sidebar already lists the assistant and Settings; the toolbar shows them otherwise.
const toolbarEntriesShown = computed(() => !(layout.value === 'persistent' && sidebarVisible.value))
const overlayOpen = computed(() => layout.value === 'overlay' && sidebarVisible.value)
// While a full-screen flow owns the screen, everything of the shell behind it is inert. The live announcer and the undo
// toast's announcement stay outside, so what happens is still heard (the toast's own button is inert, UndoToast.vue).
const covered = computed(() => anyFullScreenOpen())

const apple = isApplePlatform()
const shortcutHint = apple ? '⌘\\' : 'Ctrl+\\'
const toggleLabel = computed(() => t(sidebarVisible.value ? 'app.navigation.hideSidebar' : 'app.navigation.showSidebar'))
const toggleButton = ref<HTMLButtonElement | null>(null)
const sidebarElement = ref<HTMLElement | null>(null)
let openedFromKeyboard = false

function toggleSidebar(fromKeyboard: boolean): void {
  openedFromKeyboard = fromKeyboard && !sidebarVisible.value
  sidebar.toggle()
}

// A click with no pointer behind it (detail 0) came from Enter or Space.
function onToggleClick(event: MouseEvent): void { toggleSidebar(event.detail === 0) }

function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || layout.value === 'none' || anyModalOpen()) return
  if (isSidebarShortcut(event, apple)) {
    event.preventDefault()
    toggleSidebar(true)
  } else if (event.key === 'Escape' && overlayOpen.value) {
    event.preventDefault()
    sidebar.setVisible(false)
  }
}

// Runs before the DOM update: focus inside a sidebar that is about to become inert moves to the toggle, which
// stays in the same place. A sidebar opened from the keyboard puts focus on the current destination.
watch(sidebarVisible, (visible) => {
  if (!visible) {
    if (sidebarElement.value?.contains(document.activeElement)) toggleButton.value?.focus({ preventScroll: true })
    return
  }
  if (!openedFromKeyboard) return
  openedFromKeyboard = false
  void nextTick(() => {
    const target = sidebarElement.value?.querySelector<HTMLElement>('[aria-current="page"]') ?? sidebarElement.value?.querySelector<HTMLElement>('a[href]')
    target?.focus({ preventScroll: true })
  })
})

function closeOverlay(): void { if (overlayOpen.value) sidebar.setVisible(false) }

// Navigation started outside the sidebar also closes the overlay.
watch(current, closeOverlay)

const onStorage = (event: StorageEvent) => sidebar.onStorage(event)
onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  window.addEventListener('storage', onStorage)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  window.removeEventListener('storage', onStorage)
})

// A tab opens at its top: the previous view's offset would otherwise be clamped to whatever the new view allows.
function scrollToTop(): void { window.scrollTo({ top: 0, behavior: 'instant' }) }

const pageTitle = computed(() => currentView.value ? t(currentView.value.titleKey) : '')

// Every route has its own document title ("Week · Weeklid"), kept in the current language.
watch(pageTitle, (title) => {
  window.document.title = title ? `${title} · ${t('app.name')}` : t('app.name')
}, { immediate: true })

// After a route change (not the first load) focus moves to the new page's heading and its name is announced,
// so keyboard and screen-reader users land where sighted users look. A view that already gave way to a newer
// one does neither.
let navigated = false
watch(current, () => { navigated = true })
function onViewEntered(element: Element): void {
  if (!navigated || (element as HTMLElement).dataset.view !== currentView.value?.id) return
  // A view that already placed focus on something more specific (Today's "Saved" card after the check-in) keeps it,
  // and a sheet or full-screen flow opened meanwhile keeps it too (verify12: the heading took focus out of a review sheet).
  const active = document.activeElement
  if (active && active !== element && element.contains(active)) return
  if (anyModalOpen()) return
  element.querySelector<HTMLElement>('h1')?.focus({ preventScroll: true })
  announce(pageTitle.value)
}

// An undo offered for one workspace must not apply to another (replaced, imported or deleted meanwhile).
dismissUndoWhenChanged(() => planner.document?.workspaceId)
</script>

<template>
  <div class="shell" :data-layout="layout" :data-sidebar="sidebarVisible ? 'shown' : 'hidden'">
    <button
      v-if="layout !== 'none'"
      ref="toggleButton"
      class="sidebar-toggle"
      type="button"
      :aria-label="toggleLabel"
      :title="`${toggleLabel} (${shortcutHint})`"
      :aria-expanded="sidebarVisible ? 'true' : 'false'"
      aria-controls="app-sidebar"
      :aria-keyshortcuts="apple ? 'Meta+\\' : 'Control+\\'"
      data-testid="sidebar-toggle"
      :inert="covered || undefined"
      @click="onToggleClick"
    >
      <Icon name="panel-left" :size="22" />
    </button>
    <div v-if="layout === 'overlay'" class="sidebar-scrim" :data-open="overlayOpen || undefined" aria-hidden="true" @click="sidebar.setVisible(false)" />

    <nav
      id="app-sidebar"
      ref="sidebarElement"
      class="sidebar"
      :data-hidden="sidebarVisible ? undefined : 'true'"
      :inert="!sidebarVisible || covered"
      :aria-label="t('app.navigation.sidebar')"
    >
      <p class="sidebar-brand" data-testid="sidebar-brand"><BrandLockup :height="28" /></p>
      <ul class="sidebar-list">
        <li v-for="tab in tabs" :key="tab.id">
          <a class="sidebar-item t-body" :href="viewHash(tab.id)" :aria-current="current === tab.id ? 'page' : undefined" @click="closeOverlay">
            <Icon :name="tab.icon ?? ''" :size="22" />
            {{ t(tab.titleKey) }}
          </a>
        </li>
      </ul>
      <ul class="sidebar-list sidebar-footer" data-testid="sidebar-footer">
        <li v-for="entry in entries" :key="entry.id">
          <a class="sidebar-item t-body" :href="viewHash(entry.id)" :aria-current="current === entry.id ? 'page' : undefined" @click="closeOverlay">
            <Icon :name="entry.icon" :size="22" />
            {{ entry.title }}
          </a>
        </li>
      </ul>
    </nav>

    <div class="content" :inert="overlayOpen">
      <!-- Early in the tab order, before the page, so its Undo is a few keystrokes away from anywhere. -->
      <UndoToast />
      <StatusBanners :inert="covered || undefined" />
      <StorageUpgradeWaiting />
      <main id="main" class="main" tabindex="-1" :inert="covered || undefined">
        <RecoveryScreen v-if="planner.status === 'corrupt'" />
        <StorageErrorScreen v-else-if="planner.status === 'error' || planner.error === UPGRADE_COPY_FAILED" />
        <Transition v-else name="view" mode="out-in" @after-leave="scrollToTop" @after-enter="onViewEntered">
          <div v-if="currentView" :key="currentView.id" class="view" :data-view="currentView.id" :data-measure="FULL_WIDTH_VIEWS.has(currentView.id) ? 'full' : 'readable'">
            <LargeTitle :title="t(currentView.titleKey)">
              <template #actions>
                <span v-show="toolbarEntriesShown" class="toolbar-entries" data-testid="toolbar-entries">
                  <a
                    v-for="entry in entries"
                    :key="entry.id"
                    class="toolbar-entry"
                    :class="{ gear: entry.id === 'settings' }"
                    :href="viewHash(entry.id)"
                    :aria-label="entry.label"
                    :aria-current="current === entry.id ? 'page' : undefined"
                    :data-testid="entry.testId"
                  >
                    <Icon :name="entry.icon" :size="24" />
                  </a>
                </span>
              </template>
            </LargeTitle>
            <component :is="currentView.component" />
          </div>
        </Transition>
      </main>
    </div>

    <nav class="tabbar" :aria-label="t('app.navigation.tabs')" :inert="covered || undefined">
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
    <LiveAnnouncer />
  </div>
</template>

<style scoped>
/* --sidebar-inset is the width the sidebar takes beside the content (0 when hidden or overlaid); fixed bars
   that centre themselves in the content (undo toast, banners) read it too. */
.shell { --sidebar-inset: 0px; min-height: 100dvh; padding-inline: var(--safe-left) var(--safe-right); }
.shell[data-layout='persistent'][data-sidebar='shown'] { --sidebar-inset: var(--sidebar-width); }
/* --banners-height is the height of the fixed bottom notices (StatusBanners), so none of them covers the end of a page. */
.content { padding-bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--space-4) + var(--banners-height, 0px)); }
.main { outline: none; }
.view { margin-inline: auto; }
/* 720 px: one measure for every text and list screen, centred in the space beside the sidebar. */
.view[data-measure='readable'] { max-width: 45rem; }

.tabbar {
  position: fixed;
  inset: auto 0 0;
  z-index: 20;
  display: flex;
  justify-content: center;
  height: var(--tabbar-inset);
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
  max-width: 7.5rem;
  min-width: 0;
  min-height: var(--tap-target);
  color: var(--label-2);
  text-decoration: none;
  transition: transform 0.1s var(--ease-out);
  touch-action: manipulation;
}
.tabbar-item:active { transform: scale(0.97); }
/* Like the system tab bar, labels stop growing at large text sizes (the icon and the accessible name stay). */
.tabbar-item span { max-width: 100%; overflow: hidden; font-size: min(0.75rem, 15px); text-overflow: ellipsis; white-space: nowrap; }
/* The bar touches the screen edges, so its items draw the focus ring inside themselves. */
.tabbar-item:focus-visible { outline-offset: -2px; border-radius: var(--radius-control); }
.tabbar-item[aria-current='page'] { color: var(--tint-label); }

.toolbar-entries { display: inline-flex; align-items: center; gap: var(--space-2); }
.toolbar-entry {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--tap-target);
  height: var(--tap-target);
  border-radius: 50%;
  color: var(--tint-label);
  text-decoration: none;
  transition: transform 0.1s var(--ease-out), opacity 0.1s;
  touch-action: manipulation;
}
.toolbar-entry:active { transform: scale(0.97); opacity: 0.85; }

.sidebar { display: none; }
.sidebar-toggle { display: none; }
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

@media (min-width: 768px) {
  .tabbar { display: none; }
  .content { margin-inline-start: var(--sidebar-inset); padding-bottom: calc(var(--space-8) + var(--banners-height, 0px)); }

  /* Same spot whether the sidebar is shown or hidden: the leading edge of the toolbar row. */
  .sidebar-toggle {
    position: fixed;
    top: calc(var(--safe-top) + (var(--toolbar-height) - var(--tap-target)) / 2);
    left: calc(var(--safe-left) + var(--space-2));
    z-index: 30;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: var(--tap-target);
    height: var(--tap-target);
    padding: 0;
    border: 0;
    border-radius: var(--radius-control);
    background: transparent;
    color: var(--tint-label);
    transition: transform 0.1s var(--ease-out), opacity 0.1s;
    touch-action: manipulation;
  }
  .sidebar-toggle:hover { background: color-mix(in srgb, var(--label-2) 12%, transparent); }
  .sidebar-toggle:active { transform: scale(0.97); opacity: 0.85; }

  .sidebar {
    position: fixed;
    inset: 0 auto 0 0;
    z-index: 20;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    width: var(--sidebar-width);
    padding: var(--safe-top) var(--space-3) calc(var(--safe-bottom) + var(--space-4)) calc(var(--safe-left) + var(--space-3));
    overflow-y: auto;
    background: var(--material);
    -webkit-backdrop-filter: var(--material-filter);
    backdrop-filter: var(--material-filter);
    border-inline-end: 0.5px solid var(--separator);
    /* Leaves and returns along the same path: a critically damped spring (response 0.3 s) on transform only. */
    transition: transform 0.35s var(--ease-out), visibility 0s;
    transition-timing-function: linear(0, 0.078, 0.233, 0.399, 0.547, 0.667, 0.76, 0.83, 0.881, 0.917, 0.943, 0.961, 0.973, 0.982, 0.988, 0.992, 1), linear(0, 1);
  }
  .sidebar[data-hidden] {
    transform: translateX(calc(-100% - var(--safe-left)));
    visibility: hidden;
    transition-delay: 0s, 0.35s;
  }
  /* The brand shares the toolbar row with the toggle, after it. */
  .sidebar-brand {
    display: flex;
    align-items: center;
    min-height: var(--toolbar-height);
    margin-bottom: var(--space-2);
    padding-inline-start: calc(var(--tap-target) + var(--space-2));
  }
  .sidebar-list { display: flex; flex-direction: column; gap: 2px; }
  .sidebar-footer { margin-top: auto; }

  .sidebar-scrim {
    position: fixed;
    inset: 0;
    z-index: 19;
    background: var(--scrim);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.2s;
  }
  .sidebar-scrim[data-open] { opacity: 1; pointer-events: auto; }
  .shell[data-layout='overlay'] .sidebar { box-shadow: var(--shadow-floating); }
  .shell[data-layout='overlay'] .sidebar[data-hidden] { box-shadow: none; }
}

@media (prefers-reduced-motion: reduce) {
  /* No slide: the sidebar switches in place with a short cross-fade. */
  .sidebar, .sidebar[data-hidden] { transform: none; transition: opacity 0.15s, visibility 0s; }
  .sidebar[data-hidden] { opacity: 0; transition-delay: 0s, 0.15s; }
  .toolbar-entry:active, .sidebar-toggle:active { transform: none; opacity: 0.7; }
}
</style>

<style>
/* --tabbar-inset is what the tab bar takes from the bottom of the screen, its safe area included: floating controls
   stand on it instead of adding the bar's height and the safe area again. The tab bar's own height is this value. */
:root { --tabbar-inset: calc(var(--tabbar-height) + var(--safe-bottom)); }
/* No tab bar from 768 px: bottom offsets that clear it collapse to the safe area. */
@media (min-width: 768px) {
  :root { --tabbar-height: 0px; }
}
</style>
