import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive } from 'vue'
import { i18n } from '@/i18n'
import ItemStatusControl from './ItemStatusControl.vue'

let unmount = () => undefined as void
beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { unmount(); vi.useRealTimers() })

type Props = { title: string; status?: 'done' | 'partial' | 'skipped'; writable: boolean; plannedMinutes?: number; actualMinutes?: number; itemKey: string }

function mount(initial: Partial<Props> = {}, inForm = false) {
  const props = reactive<Props>({ title: 'Deep work', writable: true, plannedMinutes: 120, itemKey: 'a', ...initial })
  const record = vi.fn()
  const clear = vi.fn()
  i18n.global.locale.value = 'en'
  const host = document.createElement('div')
  document.body.append(host)
  const outerSubmit = vi.fn((event: Event) => event.preventDefault())
  const app = createApp({ render: () => {
    const control = h(ItemStatusControl, { ...props, onRecord: record, onClear: clear })
    return inForm ? h('form', { onSubmit: outerSubmit }, [control]) : control
  } }).use(i18n)
  app.mount(host)
  unmount = () => { app.unmount(); host.remove() }
  const circle = () => host.querySelector<HTMLButtonElement>('[data-testid="status-control"]')!
  const menu = () => host.querySelector<HTMLElement>('[data-testid="status-menu"]')
  return { host, props, record, clear, circle, menu, outerSubmit }
}

function pointer(target: Element, type: string, init: { x?: number; y?: number } = {}) {
  target.dispatchEvent(new MouseEvent(type, { bubbles: true, button: 0, clientX: init.x ?? 0, clientY: init.y ?? 0 }))
}

// Long enough for a leave transition to finish, so "closed" means gone from the DOM.
async function flush() {
  await vi.advanceTimersByTimeAsync(400)
  await nextTick()
}

describe('ItemStatusControl tap', () => {
  it('marks the item done on a tap and takes the answer back on a second tap', async () => {
    const { circle, props, record, clear } = mount()
    circle().click()
    expect(record).toHaveBeenCalledWith('done')
    props.status = 'done'
    await nextTick()
    circle().click()
    expect(clear).toHaveBeenCalledTimes(1)
    expect(record).toHaveBeenCalledTimes(1)
  })

  it.each(['partial', 'skipped'] as const)('a tap on a "%s" answer changes it to done', async (status) => {
    const { circle, record, clear } = mount({ status })
    circle().click()
    expect(record).toHaveBeenCalledWith('done')
    expect(clear).not.toHaveBeenCalled()
  })

  it('names the item and its state for assistive technology, and differs per state', async () => {
    const { circle, props } = mount()
    const names: string[] = []
    for (const status of [undefined, 'done', 'partial', 'skipped'] as const) {
      props.status = status
      await nextTick()
      names.push(circle().getAttribute('aria-label')!)
      expect(circle().getAttribute('data-status')).toBe(status ?? 'none')
    }
    expect(names).toEqual([
      'Mark Deep work as done',
      'Deep work: done. Tap to remove the answer',
      'Deep work: partly done. Tap to mark it done',
      'Deep work: not done. Tap to mark it done',
    ])
  })

  it('is disabled and silent when the plan is read-only', async () => {
    const { circle, record, menu } = mount({ writable: false })
    expect(circle().disabled).toBe(true)
    circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    expect(menu()).toBeNull()
    expect(record).not.toHaveBeenCalled()
  })
})

describe('ItemStatusControl menu', () => {
  it('opens on right click with A medias and No, and answers No', async () => {
    const { circle, menu, record } = mount()
    circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    expect([...menu()!.querySelectorAll('[role="menuitem"]')].map((item) => item.textContent?.trim())).toEqual(['Partly', 'No'])
    expect(circle().getAttribute('aria-expanded')).toBe('true')
    menu()!.querySelector<HTMLButtonElement>('[data-testid="status-skipped"]')!.click()
    await flush()
    expect(record).toHaveBeenCalledWith('skipped')
    expect(menu()).toBeNull()
  })

  it('offers to remove an existing answer, and only then', async () => {
    const { circle, menu, clear } = mount({ status: 'partial' })
    circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    expect(menu()!.querySelector('[data-testid="status-clear"]')).not.toBeNull()
    menu()!.querySelector<HTMLButtonElement>('[data-testid="status-clear"]')!.click()
    expect(clear).toHaveBeenCalledTimes(1)
  })

  it('opens on a long press, and the release that follows is not a tap', async () => {
    const { circle, menu, record } = mount()
    pointer(circle(), 'pointerdown')
    await vi.advanceTimersByTimeAsync(449)
    expect(menu()).toBeNull()
    await vi.advanceTimersByTimeAsync(2)
    await nextTick()
    expect(menu()).not.toBeNull()
    pointer(circle(), 'pointerup')
    circle().click()
    expect(record).not.toHaveBeenCalled()
    // The next real tap works again: closing the menu with a tap on the circle, then tapping once more.
    circle().click()
    await flush()
    expect(menu()).toBeNull()
    circle().click()
    expect(record).toHaveBeenCalledWith('done')
  })

  it('does not open when the finger lifts early or moves like a scroll', async () => {
    const { circle, menu } = mount()
    pointer(circle(), 'pointerdown', { x: 10, y: 10 })
    await vi.advanceTimersByTimeAsync(200)
    pointer(circle(), 'pointerup')
    await vi.advanceTimersByTimeAsync(600)
    expect(menu()).toBeNull()
    pointer(circle(), 'pointerdown', { x: 10, y: 10 })
    pointer(circle(), 'pointermove', { x: 10, y: 40 })
    await vi.advanceTimersByTimeAsync(600)
    expect(menu()).toBeNull()
  })

  it('does not swallow a keyboard activation after a long press that was released elsewhere', async () => {
    const { circle, record } = mount()
    pointer(circle(), 'pointerdown')
    await vi.advanceTimersByTimeAsync(500)
    pointer(document.body, 'pointerup')
    await vi.advanceTimersByTimeAsync(1500)
    circle().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flush()
    circle().click()
    expect(record).toHaveBeenCalledWith('done')
  })

  it('opens with arrow-down, moves with the arrows and closes with Escape, returning focus', async () => {
    const { circle, menu, host } = mount()
    circle().focus()
    circle().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    await flush()
    const items = [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')]
    expect(document.activeElement).toBe(items[0])
    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }))
    expect(document.activeElement).toBe(items[1])
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    const outer = vi.fn()
    host.addEventListener('keydown', outer)
    items[1]!.dispatchEvent(escape)
    await flush()
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(circle())
    expect(outer).not.toHaveBeenCalled()
  })

  it('leaves Escape alone while no panel is open, so a sheet around it can use it', async () => {
    const { circle, host } = mount()
    const outer = vi.fn()
    host.addEventListener('keydown', outer)
    // Vue ignores a bubbling event that reaches a listener attached in the same millisecond; the frozen clock must move.
    await vi.advanceTimersByTimeAsync(10)
    const handled = vi.spyOn(Event.prototype, 'stopPropagation')
    circle().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(handled).not.toHaveBeenCalled()
    expect(outer).toHaveBeenCalledTimes(1)
    handled.mockRestore()
  })

  it('has no menu for a task: a plain checkbox', async () => {
    const { circle, menu } = mount({ plannedMinutes: undefined })
    expect(circle().hasAttribute('aria-haspopup')).toBe(false)
    circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    pointer(circle(), 'pointerdown')
    await vi.advanceTimersByTimeAsync(600)
    expect(menu()).toBeNull()
  })

  it('closes when another pointer goes down outside it', async () => {
    const { circle, menu } = mount()
    circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    expect(menu()).not.toBeNull()
    pointer(document.body, 'pointerdown')
    await flush()
    expect(menu()).toBeNull()
  })

  it('closes the menu when the plan becomes read-only or the control is reused for another item', async () => {
    const { circle, menu, props } = mount()
    circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    props.itemKey = 'b'
    await flush()
    expect(menu()).toBeNull()
    circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    expect(menu()).not.toBeNull()
    props.writable = false
    await flush()
    expect(menu()).toBeNull()
  })
})

describe('ItemStatusControl partly done', () => {
  async function openMinutes(initial: Partial<Props> = {}, inForm = false) {
    const mounted = mount(initial, inForm)
    mounted.circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    mounted.menu()!.querySelector<HTMLButtonElement>('[data-testid="status-partial"]')!.click()
    await flush()
    const form = () => mounted.host.querySelector<HTMLElement>('[data-testid="status-minutes"]')
    const input = () => form()!.querySelector<HTMLInputElement>('input')!
    return { ...mounted, form, input }
  }

  it('asks the minutes, starting from half of the plan, and records them', async () => {
    const { form, input, record } = await openMinutes()
    expect(input().value).toBe('60')
    expect(input().max).toBe('120')
    input().value = '45'
    input().dispatchEvent(new Event('input'))
    form()!.querySelector<HTMLButtonElement>('button')!.click()
    await flush()
    expect(record).toHaveBeenCalledWith('partial', 45)
    expect(form()).toBeNull()
  })

  it.each(['click', 'Enter'])('isolates minutes saved by %s inside a surrounding form', async (method) => {
    const { host, form, input, record, outerSubmit } = await openMinutes({}, true)
    expect(host.querySelector('form form')).toBeNull()
    input().value = '45'
    input().dispatchEvent(new Event('input', { bubbles: true }))
    if (method === 'click') form()!.querySelector<HTMLButtonElement>('button')!.click()
    else input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    await flush()
    expect(record).toHaveBeenCalledExactlyOnceWith('partial', 45)
    expect(outerSubmit).not.toHaveBeenCalled()
    expect(form()).toBeNull()
  })

  it.each([-5, 125, 23])('keeps invalid minutes %s open without recording', async (minutes) => {
    const { form, input, record } = await openMinutes()
    input().value = String(minutes)
    input().dispatchEvent(new Event('input'))
    form()!.querySelector<HTMLButtonElement>('button')!.click()
    await flush()
    expect(record).not.toHaveBeenCalled()
    expect(form()).not.toBeNull()
  })

  it('swaps the menu for the minutes inside one panel, so the two never overlap while fading', async () => {
    const mounted = mount()
    mounted.circle().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await flush()
    mounted.menu()!.querySelector<HTMLButtonElement>('[data-testid="status-partial"]')!.click()
    await nextTick()
    expect(mounted.host.querySelectorAll('.panel')).toHaveLength(1)
    expect(mounted.host.querySelector('[role="menu"], [role="menuitem"]')).toBeNull()
    expect(mounted.host.querySelector('.panel')?.getAttribute('role')).toBe('group')
  })

  it('leaves the arrow keys and Tab to the minutes field', async () => {
    const { form, input } = await openMinutes()
    await vi.advanceTimersByTimeAsync(10)
    const up = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    input().dispatchEvent(up)
    expect(up.defaultPrevented).toBe(false)
    input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
    await flush()
    expect(form()).not.toBeNull()
  })

  it('starts from the minutes already recorded when an answer exists', async () => {
    const { input } = await openMinutes({ status: 'partial', actualMinutes: 30 })
    expect(input().value).toBe('30')
  })

  it('drops the draft instead of recording its minutes for another item', async () => {
    const { form, props, record } = await openMinutes()
    props.itemKey = 'next-day'
    await flush()
    expect(form()).toBeNull()
    expect(record).not.toHaveBeenCalled()
  })
})
