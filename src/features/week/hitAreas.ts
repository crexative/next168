// Every pressable Week item can be hit in at least MIN_TARGET_PX × MIN_TARGET_PX (Apple HIG, WCAG 2.5.5), whatever it
// draws. A short or narrow item gets an invisible area around its box, centred on it and kept inside the column. A
// task inside a routine gets its area over the routine: a tap just below an 18 px task opens the task, and the routine
// keeps the rest of its box. Where the areas of two neighbours would meet, the room between their boxes is split at the
// midpoint, so each tap goes to the nearest item; an area never covers another item's box.
export const MIN_TARGET_PX = 44

// A box in px from the column's top-left corner. An item is its drawn box; `gap` is the room on either side of it in
// its lane, which its area covers so that no press next to it falls between two lanes. `hostKey` names the item it is
// drawn inside, if any.
export interface Box { top: number; bottom: number; left: number; right: number }
export interface HitItem extends Box { key: string; hostKey?: string; gap?: number }

export function grown(drawn: HitItem, bounds: { width: number; height: number }): Box {
  const item = { ...drawn, left: drawn.left - (drawn.gap ?? 0), right: drawn.right + (drawn.gap ?? 0) }
  const along = (start: number, end: number, limit: number): [number, number] => {
    const size = Math.max(end - start, Math.min(MIN_TARGET_PX, limit))
    const from = Math.min(Math.max(0, (start + end) / 2 - size / 2), limit - size)
    return [from, from + size]
  }
  const [top, bottom] = along(item.top, item.bottom, bounds.height)
  const [left, right] = along(item.left, item.right, bounds.width)
  return { top, bottom, left, right }
}

const EMPTY = 0.01
const isEmpty = (box: Box) => box.bottom - box.top < EMPTY || box.right - box.left < EMPTY

// `box` less `cut`: up to four boxes (the bands above and below the cut, and the parts beside it).
export function subtract(box: Box, cut: Box): Box[] {
  if (cut.top >= box.bottom || cut.bottom <= box.top || cut.left >= box.right || cut.right <= box.left) return [box]
  const parts: Box[] = [
    { ...box, bottom: Math.min(box.bottom, cut.top) },
    { ...box, top: Math.max(box.top, cut.bottom) },
    { top: Math.max(box.top, cut.top), bottom: Math.min(box.bottom, cut.bottom), left: box.left, right: Math.min(box.right, cut.left) },
    { top: Math.max(box.top, cut.top), bottom: Math.min(box.bottom, cut.bottom), left: Math.max(box.left, cut.right), right: box.right },
  ]
  return parts.filter((part) => !isEmpty(part))
}

// The part of `item`'s grown area that goes to `other` instead: the room past the midpoint between their boxes, across
// the other's own grown area. An item drawn inside another takes its whole grown area from its host.
function claimed(item: HitItem, area: Box, other: HitItem, otherArea: Box): Box | null {
  if (item.hostKey === other.key) return null
  if (other.hostKey === item.key) return otherArea
  // Within the other's own grown area only: room it cannot take stays with this item.
  const within = (box: Box): Box => ({ top: Math.max(box.top, otherArea.top), bottom: Math.min(box.bottom, otherArea.bottom), left: Math.max(box.left, otherArea.left), right: Math.min(box.right, otherArea.right) })
  if (other.left >= item.right) return within({ ...area, left: (item.right + other.left) / 2 })
  if (other.right <= item.left) return within({ ...area, right: (other.right + item.left) / 2 })
  if (other.top >= item.bottom) return within({ ...area, top: (item.bottom + other.top) / 2 })
  if (other.bottom <= item.top) return within({ ...area, bottom: (other.bottom + item.top) / 2 })
  return other
}

// The pressable area of each item outside its own box, as boxes that cover no other item's box (an item's host
// excepted) and no room nearer to another item. Items take their areas in turn, shortest first: each takes what is
// left of its grown area once the room nearer to an item still to come is set aside, so that where three areas meet
// no room is left to nobody.
export function hitAreas(items: readonly HitItem[], bounds: { width: number; height: number }): Map<string, Box[]> {
  const grownAreas = new Map(items.map((item) => [item.key, grown(item, bounds)]))
  const order = [...items].sort((a, b) => (a.bottom - a.top) - (b.bottom - b.top))
  const taken: Box[] = []
  // The boxes an item's area may not cover: every other item's, except the routine it is drawn inside.
  const blocked = (item: HitItem): Box[] => items.filter((other) => other.key !== item.key && other.key !== item.hostKey)
  const result = new Map<string, Box[]>()
  order.forEach((item, index) => {
    const area = grownAreas.get(item.key)!
    let parts = [area]
    // Room is set aside for a later item only where that item may take it: not over another item's box.
    const reserved = order.slice(index + 1).flatMap((other) => {
      const cut = claimed(item, area, other, grownAreas.get(other.key)!)
      return cut ? blocked(other).reduce<Box[]>((parts, box) => parts.flatMap((part) => subtract(part, box)), [cut]) : []
    })
    const cuts = [...blocked(item), item, ...taken, ...reserved]
    for (const cut of cuts) parts = parts.flatMap((part) => subtract(part, cut))
    taken.push(...parts)
    result.set(item.key, parts)
  })
  return result
}

// Where items overlap or crowd each other (a task with the same time as its routine, a 45-minute task in a one-hour
// routine), not every one can own a 44 × 44 px area. Each such item gets a shared target instead: a 44 × 44 px square
// over it that opens a chooser of every item it touches. An item owns its press when some 44 × 44 px square touching
// its box is all its own: its box (less the items drawn inside it and their areas), its own areas, and no shared target.
// `outline` marks an item drawn without presses of its own (a task drawn as an outline around its routine).
export interface PressItem extends HitItem { outline?: boolean }
export interface SharedTarget { box: Box; keys: string[] }

const COVERED = 0.5
const covered = (square: Box, region: Box[]): boolean =>
  region.reduce<Box[]>((left, box) => left.flatMap((part) => subtract(part, box)), [square])
    .every((part) => part.bottom - part.top < COVERED || part.right - part.left < COVERED)

const intersects = (a: Box, b: Box) => Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > COVERED && Math.min(a.right, b.right) - Math.max(a.left, b.left) > COVERED

// The 44 × 44 px squares that touch an item's box, kept inside the column: centred on it, then along its edges.
export function candidateSquares(item: Box, bounds: { width: number; height: number }): Box[] {
  const size = Math.min(MIN_TARGET_PX, bounds.width, bounds.height)
  const clamp = (value: number, limit: number) => Math.min(Math.max(0, value), limit - size)
  const xs = [(item.left + item.right) / 2 - size / 2, item.left, item.right - size].map((x) => clamp(x, bounds.width))
  const ys = [(item.top + item.bottom) / 2 - size / 2, item.top, item.bottom - size].map((y) => clamp(y, bounds.height))
  return ys.flatMap((top) => xs.map((left) => ({ top, bottom: top + size, left, right: left + size })))
}

export function sharedTargets(items: readonly PressItem[], areas: ReadonlyMap<string, Box[]>, bounds: { width: number; height: number }): SharedTarget[] {
  const region = (item: PressItem): Box[] => {
    if (item.outline) return []
    const inside = items.filter((other) => other.hostKey === item.key && !other.outline)
    const own = inside.reduce<Box[]>((parts, other) => [other, ...(areas.get(other.key) ?? [])].reduce((rest, cut) => rest.flatMap((part) => subtract(part, cut)), parts), [item])
    return [...own, ...(areas.get(item.key) ?? [])]
  }
  const regions = new Map(items.map((item) => [item.key, region(item)]))
  let shared: Box[] = []
  for (let round = 0; round < items.length + 1; round++) {
    const member = (item: Box) => shared.some((box) => intersects(box, item))
    const without = (parts: Box[]) => shared.reduce((rest, box) => rest.flatMap((part) => subtract(part, box)), parts)
    const crowded = items.filter((item) => !member(item) && !candidateSquares(item, bounds).some((square) => covered(square, without(regions.get(item.key)!))))
    if (crowded.length === 0) break
    for (const item of crowded) {
      if (member(item)) continue
      // The square over as much of the room the item still has as possible (where its presses are), then of its box.
      const area = (a: Box, b: Box) => Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) * Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left))
      const score = (square: Box) => without(regions.get(item.key)!).reduce((sum, part) => sum + area(square, part), 0) * 4 + area(square, item)
      let box = candidateSquares(item, bounds).reduce((best, square) => score(square) > score(best) ? square : best)
      // Shared targets that meet become one.
      for (let joined = true; joined;) {
        joined = false
        shared = shared.filter((other) => {
          if (!intersects(other, box)) return true
          box = { top: Math.min(box.top, other.top), bottom: Math.max(box.bottom, other.bottom), left: Math.min(box.left, other.left), right: Math.max(box.right, other.right) }
          joined = true
          return false
        })
      }
      shared.push(box)
    }
  }
  return shared.map((box) => ({ box, keys: items.filter((item) => intersects(box, item)).map((item) => item.key) }))
}
