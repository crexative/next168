import { afterEach, describe, expect, it } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import Button from './Button.vue'

let app: ReturnType<typeof createApp> | undefined

function mountButton(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h(Button, null, () => 'Save') })
  app.mount(root)
  return root.querySelector('button')!
}

afterEach(() => {
  app?.unmount()
  document.body.innerHTML = ''
})

describe('Button press feedback', () => {
  it('ends when the press is released outside the button', async () => {
    const button = mountButton()
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4 }))
    await nextTick()
    expect(button.hasAttribute('data-pressed')).toBe(true)
    document.body.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 4 }))
    await nextTick()
    expect(button.hasAttribute('data-pressed')).toBe(false)
  })

  it('ends when the window loses focus mid-press', async () => {
    const button = mountButton()
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4 }))
    window.dispatchEvent(new Event('blur'))
    await nextTick()
    expect(button.hasAttribute('data-pressed')).toBe(false)
  })
})
