import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installTransformRecorder } from '../../e2e/support/transformRecorder'

function samples(): string[] {
  return (window as unknown as { __transforms: string[] }).__transforms
}

describe('pager transform recorder', () => {
  let track: HTMLDivElement

  beforeEach(() => {
    track = document.createElement('div')
    track.dataset.testid = 'pager-track'
    track.style.transform = 'translateX(0px)'
    document.body.append(track)
  })

  afterEach(() => {
    track.remove()
    Reflect.deleteProperty(window, '__transforms')
  })

  it.each(['now', 'release'] as const)('records only synchronous writes after starting at %s', async (start) => {
    installTransformRecorder(start)
    if (start === 'release') window.dispatchEvent(new Event('pointerup'))

    track.style.transform = 'translateX(10px)'
    track.style.transform = 'translateX(20px)'

    await vi.waitFor(() => {
      expect(samples()).toEqual(['translateX(10px)', 'translateX(20px)'])
    })
  })

  it.each(['now', 'release'] as const)('excludes the initial transform with one write after starting at %s', async (start) => {
    installTransformRecorder(start)
    if (start === 'release') window.dispatchEvent(new Event('pointerup'))

    track.style.transform = 'translateX(10px)'

    await vi.waitFor(() => {
      expect(samples()).toEqual(['translateX(10px)'])
    })
  })

  it.each(['now', 'release'] as const)('records nothing without writes after starting at %s', async (start) => {
    installTransformRecorder(start)
    if (start === 'release') window.dispatchEvent(new Event('pointerup'))

    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(samples()).toEqual([])
  })

  it('records a transient transform set and restored synchronously in one task', async () => {
    installTransformRecorder()

    track.style.transform = 'translateX(99px)'
    track.style.transform = 'translateX(0px)'

    await vi.waitFor(() => {
      expect(samples()).toEqual(['translateX(99px)', 'translateX(0px)'])
    })
  })

  it('starts at pointer release before bubble handlers, excluding the drag transform', async () => {
    installTransformRecorder('release')
    track.style.transform = 'translateX(-40px)'
    expect(samples()).toEqual([])
    window.addEventListener('pointerup', () => {
      track.style.transform = 'translateX(99px)'
      track.style.transform = 'translateX(0px)'
    }, { once: true })

    window.dispatchEvent(new Event('pointerup'))

    await vi.waitFor(() => {
      expect(samples()).toEqual(['translateX(99px)', 'translateX(0px)'])
    })
  })

  it('parses style attribute snapshots and records removal across successive batches', async () => {
    installTransformRecorder()
    track.setAttribute('style', 'opacity: 0.5; transform: translateX(calc(-300% + 0px));')
    track.style.transform = 'translateX(99px)'
    track.style.removeProperty('transform')

    await vi.waitFor(() => {
      expect(samples()).toEqual([
        'translateX(calc(-300% + 0px))', 'translateX(99px)', '',
      ])
    })

    track.style.transform = 'translateX(20px)'
    await vi.waitFor(() => {
      expect(samples()).toEqual([
        'translateX(calc(-300% + 0px))', 'translateX(99px)', '', 'translateX(20px)',
      ])
    })
  })
})
