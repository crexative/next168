import { afterEach, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { createPinia } from 'pinia'
import type { DayIndex } from '@/core/model'
import { i18n } from '@/i18n'
import DayPicker from './DayPicker.vue'

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = '' })

async function mount(days: DayIndex[]): Promise<HTMLElement> {
  i18n.global.locale.value = 'en'
  const root = document.body.appendChild(document.createElement('div'))
  app = createApp({ render: () => h(DayPicker, { days }) }).use(createPinia()).use(i18n)
  app.mount(root)
  await nextTick()
  return root
}

it('days that match no preset show as the chosen "Choose days" chip naming them, the seven toggles one tap away', async () => {
  const root = await mount([0, 1, 2, 3, 4])
  const pick = root.querySelector<HTMLButtonElement>('[data-preset=pick]')!
  expect(pick.getAttribute('aria-pressed')).toBe('true')
  expect(pick.getAttribute('aria-expanded')).toBe('false')
  expect(pick.textContent).not.toContain('Choose days')
  expect(root.querySelectorAll('[data-day]')).toHaveLength(0)
  pick.click()
  await nextTick()
  expect(root.querySelectorAll('[data-day]')).toHaveLength(7)
  expect(pick.textContent).toContain('Choose days')
})

it('a preset is the chosen chip and "Choose days" stays plain', async () => {
  const root = await mount([1, 2, 3, 4, 5])
  expect(root.querySelector('[data-preset=weekdays]')!.getAttribute('aria-pressed')).toBe('true')
  expect(root.querySelector('[data-preset=pick]')!.getAttribute('aria-pressed')).toBe('false')
})

it('Escape puts the seven days away, back on "Choose days", and goes no further while they are open', async () => {
  const root = await mount([1, 2, 3, 4, 5])
  const outer = vi.fn()
  root.addEventListener('keydown', outer)
  const pick = root.querySelector<HTMLButtonElement>('[data-preset=pick]')!
  pick.click()
  await nextTick()
  const day = root.querySelector<HTMLButtonElement>('[data-day="1"]')!
  day.focus()
  day.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  await nextTick()
  await nextTick()
  expect(root.querySelector('[data-day="1"]')).toBeNull()
  expect(pick.getAttribute('aria-expanded')).toBe('false')
  expect(document.activeElement).toBe(pick)
  expect(outer).not.toHaveBeenCalled()
  // With the days put away, Escape is the time list's or the sheet's again.
  pick.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
  expect(outer).toHaveBeenCalledTimes(1)
})
