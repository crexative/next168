import { computed, shallowReactive, shallowRef } from 'vue'
import type { AddEntryDefinition, SettingsSectionDefinition, ShellRegistry, ViewDefinition, ViewId } from './contracts'

export function createShellRegistry() {
  const views = shallowReactive(new Map<ViewId, ViewDefinition>())
  const sections = shallowReactive(new Map<string, SettingsSectionDefinition>())
  const addEntry = shallowRef<AddEntryDefinition | null>(null)

  const registry: ShellRegistry = {
    registerView(definition) {
      views.set(definition.id, definition)
    },
    registerSettingsSection(definition) {
      sections.set(definition.id, definition)
    },
    registerAddEntry(definition) {
      addEntry.value = definition
    },
  }

  const tabs = computed(() =>
    [...views.values()]
      .filter((view): view is ViewDefinition & { tabOrder: number } => view.tabOrder !== undefined)
      .sort((left, right) => left.tabOrder - right.tabOrder),
  )
  const settingsSections = computed(() => [...sections.values()].sort((left, right) => left.order - right.order))

  return { registry, views, tabs, settingsSections, addEntry }
}

export const shell = createShellRegistry()
