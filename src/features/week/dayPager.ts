import { rubberBand } from '@/ui/sheetMotion'

export interface PointerSample { time: number; x: number }

const VELOCITY_WINDOW_MS = 100
// UIScrollView's normal deceleration rate; projects where a flick would come to rest.
const DECELERATION_RATE = 0.998

export function horizontalVelocity(samples: PointerSample[]): number {
  const last = samples[samples.length - 1]
  const first = samples.find((sample) => last !== undefined && last.time - sample.time <= VELOCITY_WINDOW_MS)
  if (!first || !last || last.time === first.time) return 0
  return ((last.x - first.x) / (last.time - first.time)) * 1000
}

export function projectDistance(velocityPxPerS: number): number {
  return (velocityPxPerS / 1000) * DECELERATION_RATE / (1 - DECELERATION_RATE)
}

// A release moves at most one day, toward where the projected flick would rest.
export function targetIndex(index: number, offset: number, velocity: number, width: number, count: number): number {
  if (width <= 0) return index
  const projected = offset + projectDistance(velocity)
  const step = Math.max(-1, Math.min(1, Math.round(-projected / width)))
  return Math.max(0, Math.min(count - 1, index + step))
}

// 1:1 tracking inside the week; elastic resistance past the first and last day.
export function dragOffset(distance: number, index: number, count: number, width: number): number {
  const pastStart = index === 0 && distance > 0
  const pastEnd = index === count - 1 && distance < 0
  if (!pastStart && !pastEnd) return distance
  return Math.sign(distance) * -rubberBand(-Math.abs(distance), width)
}
