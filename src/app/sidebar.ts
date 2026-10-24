import { computed, ref, watch, type Ref } from 'vue'

// Desktop and tablet navigation: a sidebar people can hide (HIG sidebars › "Consider letting people hide the
// sidebar… Avoid hiding the sidebar by default"). Below 768 px the tab bar navigates and there is no sidebar.
//   overlay    768–1023 px: starts hidden, opens over the content with a scrim.
//   persistent ≥1024 px: a column beside the content; shown or hidden is remembered per device.
export type SidebarLayout = 'none' | 'overlay' | 'persistent'
export type SidebarPreference = 'shown' | 'hidden'

export const SIDEBAR_KEY = 'next168-sidebar'
export const OVERLAY_QUERY = '(min-width: 768px)'
export const PERSISTENT_QUERY = '(min-width: 1024px)'

export function layoutFor(atLeastTablet: boolean, atLeastDesktop: boolean): SidebarLayout {
  if (atLeastDesktop) return 'persistent'
  return atLeastTablet ? 'overlay' : 'none'
}

// Shown unless the person hid it on this device: never hidden by default.
export function storedSidebar(): SidebarPreference {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === 'hidden' ? 'hidden' : 'shown'
  } catch {
    return 'shown'
  }
}

function storeSidebar(value: SidebarPreference): void {
  try {
    if (value === 'shown') localStorage.removeItem(SIDEBAR_KEY)
    else localStorage.setItem(SIDEBAR_KEY, value)
  } catch {
    // The choice still applies to this session.
  }
}

// ⌘\ on Apple platforms, Ctrl+\ elsewhere (the web convention; Ctrl+S would save the page on Windows).
export function isApplePlatform(platform: string = typeof navigator === 'undefined' ? '' : navigator.platform): boolean {
  return /mac|iphone|ipad|ipod/i.test(platform)
}

export function isSidebarShortcut(event: Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>, apple: boolean): boolean {
  if (event.altKey || event.shiftKey) return false
  const modifier = apple ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey
  return modifier && (event.key === '\\' || event.code === 'Backslash')
}

// One remembered choice for the page, like the appearance: "delete all data" resets it at once.
const preference = ref<SidebarPreference>(storedSidebar())

export function resetSidebar(): void {
  preference.value = 'shown'
  storeSidebar('shown')
}

export function useSidebar(layout: Ref<SidebarLayout>) {
  const overlayOpen = ref(false)

  // A layout change (window resized across a breakpoint) closes the overlay: it always starts hidden.
  watch(layout, () => { overlayOpen.value = false })

  const visible = computed(() => {
    if (layout.value === 'persistent') return preference.value === 'shown'
    if (layout.value === 'overlay') return overlayOpen.value
    return false
  })

  function setVisible(next: boolean): void {
    if (layout.value === 'persistent') {
      preference.value = next ? 'shown' : 'hidden'
      storeSidebar(preference.value)
    } else if (layout.value === 'overlay') {
      overlayOpen.value = next
    }
  }

  function toggle(): void { setVisible(!visible.value) }

  // Another tab of this app changed the remembered choice: follow it, so both windows agree.
  function onStorage(event: Pick<StorageEvent, 'key'>): void {
    if (event.key === SIDEBAR_KEY || event.key === null) preference.value = storedSidebar()
  }

  return { visible, setVisible, toggle, onStorage }
}
