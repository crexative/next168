// One of the items a shared press target offers in its chooser (DayColumn.vue › shared targets).
export interface PressOption {
  key: string
  kind: 'block' | 'task' | 'event'
  title: string
  range: string
  activate: () => void
  // The item's own control: focus goes there before the item opens, so it comes back there when the item closes.
  anchor: () => HTMLElement | null
}
