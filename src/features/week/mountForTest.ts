import { createApp, h, nextTick, type Component } from 'vue'
import { i18n } from '@/i18n'

export async function mountForTest(component: Component, props: Record<string, unknown>) {
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp({ render: () => h(component, props) })
  app.use(i18n)
  app.mount(host)
  await nextTick()
  return {
    host,
    unmount: () => { app.unmount(); host.remove() },
  }
}
