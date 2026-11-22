import { afterEach, expect, it } from 'vitest'
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
