import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { i18n } from '@/i18n'
import type { PlannerDocument } from '@/core/model'
import { configurePlannerStore, usePlannerStore } from '@/stores/plannerStore'
import { createTestRepositories, fixedNow, newTestId, testDocument } from '@/repositories/testSupport'

export interface Mounted {
  host: HTMLElement
  store: ReturnType<typeof usePlannerStore>
  unmount: () => void
}

// Mounts a component on a loaded planner store holding `overrides` over an empty document.
export async function mountWithPlanner(component: object, overrides: Partial<PlannerDocument> = {}, locale = 'en'): Promise<Mounted> {
  const pinia = createPinia()
  setActivePinia(pinia)
  const repos = createTestRepositories()
  configurePlannerStore({ repository: repos.planner, now: fixedNow, newId: newTestId, locale: () => locale, timeZone: () => 'UTC' })
  await repos.planner.save({ ...testDocument(), ...overrides, revision: 1 }, 0)
  const store = usePlannerStore()
  await store.load()
  i18n.global.locale.value = locale as typeof i18n.global.locale.value
  const host = document.createElement('div')
  document.body.append(host)
  const app: App = createApp(component).use(pinia).use(i18n)
  app.mount(host)
  await nextTick()
  return { host, store, unmount: () => { app.unmount(); host.remove() } }
}

export const WORK = { id: 'c-work', name: 'Work', colorKey: 'blue', goal: { type: 'max', hoursPerWeek: 40 } } as const
export const SLEEP = { id: 'c-sleep', name: 'Sleep', colorKey: 'purple', icon: '😴', goal: { type: 'min', hoursPerWeek: 49 } } as const
