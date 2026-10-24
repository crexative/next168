import { h } from 'vue'
import type { ShellRegistry, ViewId } from './contracts'
import PlaceholderView from './PlaceholderView.vue'
import SettingsView from './SettingsView.vue'
import PreferencesSettings from './settings/PreferencesSettings.vue'

const TABS: { id: Extract<ViewId, 'today' | 'week' | 'tasks' | 'insights'>; icon: string }[] = [
  { id: 'today', icon: 'sun' },
  { id: 'week', icon: 'calendar-days' },
  { id: 'tasks', icon: 'list-checks' },
  { id: 'insights', icon: 'chart-no-axes-column' },
]

export function registerBuiltinViews(registry: ShellRegistry): void {
  TABS.forEach(({ id, icon }, index) => {
    registry.registerView({
      id,
      titleKey: `app.tabs.${id}`,
      icon,
      tabOrder: index,
      component: { name: `${id}Placeholder`, render: () => h(PlaceholderView, { view: id }) },
    })
  })
  registry.registerView({ id: 'settings', titleKey: 'app.tabs.settings', icon: 'settings', component: SettingsView })
  registry.registerSettingsSection({ id: 'preferences', titleKey: 'common.preferences.title', order: 25, component: PreferencesSettings })
}
