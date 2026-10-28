// What the details sheet shows for a calendar event or a Weeklid event tapped in the grid.
export interface BusyDetails {
  // The grid item it was opened from: when that item leaves the grid (a calendar forgotten or refreshed away), the
  // sheet closes rather than keep showing it.
  key?: string
  title: string
  date: string
  range: string
  calendar: string
  // A Weeklid event's own place and notes, when it has them.
  location?: string
  notes?: string
  conflictsWith: { blockId: string; title: string }[]
}
