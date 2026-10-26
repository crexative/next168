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

function grown(drawn: HitItem, bounds: { width: number; height: number }): Box {
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
