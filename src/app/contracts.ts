import type { Component } from 'vue'

// Shell plug-in contract (architecture §7 #14). S0-shell implements the registries; feature slices
// register their views and settings sections from their own `index.ts` without editing shell files.

export type ViewId = 'today' | 'week' | 'tasks' | 'insights' | 'settings' | 'checkin' | 'assistant' | 'proposals'

export interface ViewDefinition {
  id: ViewId
  component: Component
  titleKey: string        // i18n key
  icon?: string           // lucide icon name; views without icon are not in the tab bar
  tabOrder?: number       // present only for Today, Week, Tasks, Insights
}

export interface SettingsSectionDefinition {
  id: string
  component: Component
  titleKey: string
  order: number
}

export interface ShellRegistry {
  registerView(definition: ViewDefinition): void
  registerSettingsSection(definition: SettingsSectionDefinition): void
}
