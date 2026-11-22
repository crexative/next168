import { afterEach, expect, it } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { i18n } from '@/i18n'
import PressChooserSheet from './PressChooserSheet.vue'
import type { PressOption } from './pressOption'

let app: App | undefined
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = '' })

const option = (extra: Partial<PressOption>): PressOption => ({ key: 'k', kind: 'task', title: 'Report', range: '9:00–9:30', activate: () => {}, anchor: () => null, ...extra })

it('a piece of a split task is shown compactly and heard with its part in words; other items are read as shown', async () => {
  i18n.global.locale.value = 'en'
  const root = document.body.appendChild(document.createElement('div'))
  app = createApp({ render: () => h(PressChooserSheet, { open: true, options: [option({ key: 'a', title: '1/2 Report', spokenTitle: '1/2 Report, part 1 of 2' }), option({ key: 'b', kind: 'block', title: 'Work' })] }) })
  app.use(i18n).mount(root)
  await nextTick()
  const titles = [...document.querySelectorAll('[data-testid="press-choice"] .choice-title')]
  expect(titles.map((title) => title.querySelector('[aria-hidden="true"]')?.textContent ?? null)).toEqual(['1/2 Report', null])
  expect(titles.map((title) => title.querySelector('.visually-hidden')?.textContent ?? title.textContent)).toEqual(['1/2 Report, part 1 of 2', 'Work'])
})
