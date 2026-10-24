import type { Component } from 'vue'
import {
  CalendarDays, Check, ChartNoAxesColumn, ChevronRight, Inbox, Info, ListChecks, Plus, RefreshCw,
  Settings, Sun, TriangleAlert, Undo2, X,
} from 'lucide-vue-next'

// Kebab-case lucide names. Feature slices add theirs with registerIcons() from their own index.ts.
const registry = new Map<string, Component>(Object.entries({
  'calendar-days': CalendarDays,
  check: Check,
  'chart-no-axes-column': ChartNoAxesColumn,
  'chevron-right': ChevronRight,
  inbox: Inbox,
  info: Info,
  'list-checks': ListChecks,
  plus: Plus,
  'refresh-cw': RefreshCw,
  settings: Settings,
  sun: Sun,
  'triangle-alert': TriangleAlert,
  'undo-2': Undo2,
  x: X,
}))

export function registerIcons(icons: Record<string, Component>): void {
  for (const [name, component] of Object.entries(icons)) registry.set(name, component)
}

export function resolveIcon(name: string): Component | undefined {
  return registry.get(name)
}
