import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, reactive, type App } from 'vue'
import SetupFrame from './SetupFrame.vue'

let app: App | undefined

afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
})

it('keeps focus already inside the frame when it unlocks', async () => {
  const state = reactive({ open: true, locked: false })
  const host = document.createElement('div')
  document.body.append(host)
  app = createApp({
    render: () => h(SetupFrame, {
      ...state, title: 'Setup', closeLabel: 'Leave', progressLabel: 'Part 1 of 5', countLabel: '1 of 5',
      part: 1, total: 5, dirty: false,
    }, () => [
      h('h3', { tabindex: -1, 'data-setup-initial-focus': '' }, 'Current question'),
      h('button', { id: 'answer' }, 'Current answer'),
    ]),
  })
  app.mount(host)
  const question = document.querySelector('h3')!
  await vi.waitFor(() => expect(document.activeElement).toBe(question))

  const answer = document.querySelector<HTMLButtonElement>('#answer')!
  answer.focus()
  state.locked = true
  await vi.waitFor(() => expect(document.querySelector('.setup-close')?.hasAttribute('disabled')).toBe(true))
  state.locked = false
  await vi.waitFor(() => expect(document.querySelector('.setup-close')?.hasAttribute('disabled')).toBe(false))
  expect(document.activeElement).toBe(answer)
})
