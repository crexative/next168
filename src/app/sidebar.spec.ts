// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { nextTick, ref } from 'vue'
import { isApplePlatform, isSidebarShortcut, layoutFor, resetSidebar, SIDEBAR_KEY, storedSidebar, useSidebar, type SidebarLayout } from './sidebar'

afterEach(() => { resetSidebar(); localStorage.clear() })

const key = (overrides: Partial<KeyboardEvent>) => ({ key: '\\', code: 'Backslash', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...overrides })

it('has no sidebar on a phone, an overlay from 768 px and a column from 1024 px', () => {
  expect(layoutFor(false, false)).toBe('none')
  expect(layoutFor(true, false)).toBe('overlay')
  expect(layoutFor(true, true)).toBe('persistent')
})

it('is shown by default and remembers being hidden on this device', () => {
  const layout = ref<SidebarLayout>('persistent')
  const first = useSidebar(layout)
  expect(first.visible.value).toBe(true)
  first.toggle()
  expect(first.visible.value).toBe(false)
  expect(localStorage.getItem(SIDEBAR_KEY)).toBe('hidden')
  // A new page load reads the stored choice.
  expect(storedSidebar()).toBe('hidden')
  first.toggle()
  expect(storedSidebar()).toBe('shown')
  expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull()
})

it('starts collapsed as an overlay, never stores the overlay state, and closes when the layout changes', async () => {
  const layout = ref<SidebarLayout>('overlay')
  const sidebar = useSidebar(layout)
  expect(sidebar.visible.value).toBe(false)
  sidebar.toggle()
  expect(sidebar.visible.value).toBe(true)
  expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull()
  layout.value = 'persistent'
  await nextTick()
  layout.value = 'overlay'
  await nextTick()
  expect(sidebar.visible.value).toBe(false)
})

it('has nothing to toggle on a phone', () => {
  const sidebar = useSidebar(ref<SidebarLayout>('none'))
  sidebar.toggle()
  expect(sidebar.visible.value).toBe(false)
  expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull()
})

it('shows the sidebar again at once when "delete all data" forgets the choice', () => {
  const sidebar = useSidebar(ref<SidebarLayout>('persistent'))
  sidebar.toggle()
  expect(sidebar.visible.value).toBe(false)
  resetSidebar()
  expect(sidebar.visible.value).toBe(true)
  expect(localStorage.getItem(SIDEBAR_KEY)).toBeNull()
})

it('follows a choice made in another tab', () => {
  const sidebar = useSidebar(ref<SidebarLayout>('persistent'))
  localStorage.setItem(SIDEBAR_KEY, 'hidden')
  sidebar.onStorage({ key: 'next168-appearance' })
  expect(sidebar.visible.value).toBe(true)
  sidebar.onStorage({ key: SIDEBAR_KEY })
  expect(sidebar.visible.value).toBe(false)
})

it('falls back to shown when storage cannot be read', () => {
  const original = Storage.prototype.getItem
  Storage.prototype.getItem = () => { throw new Error('blocked') }
  try {
    expect(storedSidebar()).toBe('shown')
  } finally {
    Storage.prototype.getItem = original
  }
})

it('toggles with ⌘\\ on Apple platforms and Ctrl+\\ elsewhere, and nothing else', () => {
  expect(isApplePlatform('MacIntel')).toBe(true)
  expect(isApplePlatform('iPad')).toBe(true)
  expect(isApplePlatform('Win32')).toBe(false)
  expect(isApplePlatform('Linux x86_64')).toBe(false)

  expect(isSidebarShortcut(key({ metaKey: true }), true)).toBe(true)
  expect(isSidebarShortcut(key({ ctrlKey: true }), true)).toBe(false)
  expect(isSidebarShortcut(key({ ctrlKey: true }), false)).toBe(true)
  expect(isSidebarShortcut(key({ metaKey: true }), false)).toBe(false)
  // A layout where the key under Backslash prints something else still matches by its code.
  expect(isSidebarShortcut(key({ ctrlKey: true, key: '#' }), false)).toBe(true)
  expect(isSidebarShortcut(key({ ctrlKey: true, shiftKey: true }), false)).toBe(false)
  expect(isSidebarShortcut(key({ ctrlKey: true, altKey: true }), false)).toBe(false)
  expect(isSidebarShortcut(key({ ctrlKey: true, key: 's', code: 'KeyS' }), false)).toBe(false)
  expect(isSidebarShortcut(key({}), false)).toBe(false)
})
