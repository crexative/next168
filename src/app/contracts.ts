import type { Component, InjectionKey } from 'vue'

// Shell plug-in contract (architecture §7 #14). S0-shell implements the registries; feature slices
// register their views and settings sections from their own `index.ts` without editing shell files.

export type ViewId = 'today' | 'week' | 'tasks' | 'insights' | 'settings' | 'checkin' | 'assistant' | 'proposals'

export interface ViewDefinition {
  id: ViewId
  component: Component
  titleKey: string        // i18n key
  icon?: string           // lucide icon name; views without icon are not in the tab bar
  tabOrder?: number       // present only for Today, Week, Tasks, Insights
  backdrop?: 'plain'      // the page is plain lists on white; without it the page is grouped (cards on grey)
}

// Where the shell draws the one "+" (redesign 2026-11, principle 4): beside the phone's floating tab bar, at the end of
// the tablet toolbar, or as "Añadir" in the desktop page's title row.
export type AddPlacement = 'floating' | 'toolbar' | 'title'

// The component behind the shell's "+". It receives the current view and its placement; Tasks adds a task directly,
// every other tab offers task, event and routine.
export interface AddEntryDefinition {
  component: Component
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
  registerAddEntry(definition: AddEntryDefinition): void
}

// The shell draws the assistant and Settings entries in every view's toolbar (same place, same order on every
// tab). A view that still places its own assistant entry defers to the shell's when this is provided.
export const SHELL_TOOLBAR_ENTRIES: InjectionKey<boolean> = Symbol('shell-toolbar-entries')
