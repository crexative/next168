// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest'
import { createApp, nextTick } from 'vue'
import { SHELL_TOOLBAR_ENTRIES } from '@/app/contracts'
import { i18n } from '@/i18n'
import AssistantEntryButton from './AssistantEntryButton.vue'

let host: HTMLElement | undefined
let toolbar: HTMLElement | undefined
afterEach(() => { host?.remove(); toolbar?.remove(); host = toolbar = undefined })

function mount(insideShell = false) {
  host = document.createElement('div')
  document.body.append(host)
  i18n.global.locale.value = 'en'
  const app = createApp(AssistantEntryButton).use(i18n)
  if (insideShell) app.provide(SHELL_TOOLBAR_ENTRIES, true)
  app.mount(host)
}

it('is an icon link to the assistant with an accessible name', async () => {
  mount()
  await nextTick()
  const link = document.querySelector<HTMLAnchorElement>('[data-testid=assistant-entry]')!
  expect(link.getAttribute('href')).toBe('#/assistant')
  expect(link.getAttribute('aria-label')).toBe('Ask the assistant')
  expect(link.textContent?.trim()).toBe('')
  expect(link.querySelector('svg')).not.toBeNull()
})

it('moves itself into the shell toolbar when there is one', async () => {
  toolbar = document.createElement('div')
  toolbar.id = 'toolbar-actions'
  document.body.append(toolbar)
  mount()
  await nextTick()
  await nextTick()
  expect(toolbar.querySelector('[data-testid=assistant-entry]')).not.toBeNull()
  expect(host!.querySelector('[data-testid=assistant-entry]')).toBeNull()
})

it('renders nothing inside the app shell, which draws the one assistant entry on every tab', async () => {
  toolbar = document.createElement('div')
  toolbar.id = 'toolbar-actions'
  document.body.append(toolbar)
  mount(true)
  await nextTick()
  await nextTick()
  expect(document.querySelector('[data-testid=assistant-entry]')).toBeNull()
})
