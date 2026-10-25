import type { Page } from '@playwright/test'

export interface MotionSamples {
  // Computed transforms other than "none" seen on any element under the root, on any animation frame.
  transforms: string[]
  // Web Animations (CSS transitions and animations included) on elements under the root that animate transform.
  animations: string[]
}

// Samples every element under `root` on every animation frame until collected. Keep the function self-contained:
// Playwright serializes it into the page.
export async function installMotionSampler(page: Page, root: string): Promise<void> {
  await page.evaluate((selector) => {
    const transforms = new Set<string>()
    const animations = new Set<string>()
    const state = { running: true, transforms, animations }
    ;(window as unknown as { __motion: typeof state }).__motion = state
    const describe = (element: Element) => `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.trim().split(/\s+/).join('.')}` : ''}`
    const sample = () => {
      if (!state.running) return
      const scope = document.querySelector(selector)
      if (scope) {
        for (const element of [scope, ...Array.from(scope.querySelectorAll('*'))]) {
          const transform = getComputedStyle(element).transform
          if (transform && transform !== 'none') transforms.add(`${describe(element)}: ${transform}`)
        }
      }
      for (const animation of document.getAnimations()) {
        const target = (animation.effect as KeyframeEffect | null)?.target
        if (!target || !target.closest(selector)) continue
        const keyframes = (animation.effect as KeyframeEffect).getKeyframes()
        if (keyframes.some((frame) => 'transform' in frame)) animations.add(`${describe(target)}: ${(animation as CSSTransition).transitionProperty ?? animation.id ?? 'animation'}`)
      }
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  }, root)
}

export async function collectMotion(page: Page): Promise<MotionSamples> {
  return page.evaluate(() => {
    const state = (window as unknown as { __motion: { running: boolean; transforms: Set<string>; animations: Set<string> } }).__motion
    state.running = false
    return { transforms: [...state.transforms], animations: [...state.animations] }
  })
}
