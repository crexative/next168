import { ref } from 'vue'

// The sheets on screen, in the order they opened (Sheet.vue). One sheet may hand off to the next (a chooser opens an
// editor, a details sheet opens the routine it conflicts with): the closing sheet finishes its animation after the
// next one has taken focus, so focus and the page's `data-sheet-open` follow this list, never one sheet alone.
export interface SheetEntry {
  panel: () => HTMLElement | null
  // Where focus goes when this sheet closes and no other sheet is open.
  returnFocusTo: HTMLElement | null
  closing: boolean
}

const entries: SheetEntry[] = []

function syncPageFlag(): void {
  if (entries.some((entry) => !entry.closing)) document.documentElement.dataset.sheetOpen = ''
  else delete document.documentElement.dataset.sheetOpen
}

// A sheet opening from inside another (focus is in that sheet's panel) returns focus where that sheet would have: the
// control that opened the first sheet, not a control of a sheet that is going away.
export function openSheet(entry: Omit<SheetEntry, 'returnFocusTo' | 'closing'>): SheetEntry {
  const active = document.activeElement as HTMLElement | null
  const from = entries.find((other) => active && other.panel()?.contains(active))
  const opened: SheetEntry = { ...entry, returnFocusTo: from ? from.returnFocusTo : active, closing: false }
  entries.push(opened)
  syncPageFlag()
  return opened
}

// A close interrupted by a reopen: the sheet is open again.
export function reopenedSheet(entry: SheetEntry): void {
  entry.closing = false
  syncPageFlag()
}

export function closingSheet(entry: SheetEntry): void {
  entry.closing = true
  syncPageFlag()
}

// After its close: focus returns only when no other sheet is open and nothing else took focus in the meantime (focus
// is on the page body, where it falls when the focused control left with the sheet).
export function closedSheet(entry: SheetEntry): void {
  const index = entries.indexOf(entry)
  if (index >= 0) entries.splice(index, 1)
  syncPageFlag()
  const active = document.activeElement
  const free = active === null || active === document.body || Boolean(entry.panel()?.contains(active))
  if (!entries.some((other) => !other.closing) && free && entry.returnFocusTo?.isConnected) entry.returnFocusTo.focus()
}

// A sheet torn down without closing (its page went away): it leaves the list, and nothing moves focus.
export function droppedSheet(entry: SheetEntry): void {
  const index = entries.indexOf(entry)
  if (index >= 0) entries.splice(index, 1)
  syncPageFlag()
}

// Whether a sheet is open: page-level focus moves (a new page's heading) wait for it, so they never take focus out of it.
export function anySheetOpen(): boolean {
  return entries.some((entry) => !entry.closing)
}

// ---------- Full-screen owners ----------

// A full-screen flow (the guided setup) owns the whole screen while it is open: the page behind it is inert, no sheet
// opens over or under it (Sheet.vue waits), and page-level focus moves wait for it. It never sets `data-sheet-open`,
// which scales the page behind a sheet.
const fullScreenOwners = ref(0)

// While any owner is open the page behind cannot scroll; its position comes back when the last owner releases.
const LOCK_CLASS = 'page-locked'
let lockedScrollY = 0

function lockPage(): void {
  lockedScrollY = window.scrollY
  document.documentElement.classList.add(LOCK_CLASS)
}

function unlockPage(): void {
  document.documentElement.classList.remove(LOCK_CLASS)
  if (window.scrollY !== lockedScrollY) window.scrollTo(0, lockedScrollY)
}

// Registers an owner; the returned release may be called any number of times.
export function openFullScreen(): () => void {
  if (fullScreenOwners.value === 0) lockPage()
  fullScreenOwners.value += 1
  let released = false
  return () => {
    if (released) return
    released = true
    fullScreenOwners.value -= 1
    if (fullScreenOwners.value === 0) unlockPage()
  }
}

// Reactive: a computed or template that reads it updates when an owner opens or releases.
export function anyFullScreenOpen(): boolean {
  return fullScreenOwners.value > 0
}

export function anyModalOpen(): boolean {
  return anySheetOpen() || anyFullScreenOpen()
}
