import { animate } from 'motion'

export const DISMISS_VELOCITY_PX_PER_S = 500
export const DISMISS_OFFSET_RATIO = 0.4

export interface Sample { time: number; y: number }

export function releaseVelocity(samples: Sample[]): number {
  const last = samples[samples.length - 1]
  const first = samples.find((sample) => last !== undefined && last.time - sample.time <= 100)
  if (!first || !last || last.time === first.time) return 0
  return ((last.y - first.y) / (last.time - first.time)) * 1000
}

// Resistance that grows with distance, so dragging above the resting position feels elastic.
export function rubberBand(distance: number, dimension: number): number {
  if (distance >= 0) return distance
  const magnitude = -distance
  return -(1 - 1 / ((magnitude * 0.55) / dimension + 1)) * dimension
}

export function shouldDismiss(offset: number, velocity: number, height: number): boolean {
  return velocity > DISMISS_VELOCITY_PX_PER_S || offset > height * DISMISS_OFFSET_RATIO
}

export interface SpringOptions { velocity?: number; bounce?: number; duration?: number }

// Spring that hands the release velocity over to the animation; resolves when it settles.
export function springTo(from: number, to: number, onUpdate: (value: number) => void, options: SpringOptions = {}): { stop(): void; finished: Promise<void> } {
  const controls = animate(from, to, {
    type: 'spring',
    duration: options.duration ?? 0.35,
    bounce: options.bounce ?? 0,
    velocity: options.velocity ?? 0,
    onUpdate,
  })
  return {
    stop: () => controls.stop(),
    finished: Promise.resolve(controls).then(() => undefined, () => undefined),
  }
}
