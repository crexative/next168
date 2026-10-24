// What the details sheet shows for a calendar event or a Next168 event tapped in the grid.
export interface BusyDetails {
  title: string
  date: string
  range: string
  calendar: string
  conflictsWith: { blockId: string; title: string }[]
}
