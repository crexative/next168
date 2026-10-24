import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import TaskRow from './TaskRow.vue'

let app: ReturnType<typeof createApp> | undefined
const onComplete = vi.fn()
const onRemove = vi.fn()
const onOpen = vi.fn()

function mountRow(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h('ul', [h(TaskRow, { title: 'Report', color: 'red', completeLabel: 'Complete', onComplete, onRemove, onOpen })]) })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en: { tasks: { swipeRemove: 'Delete' } } } })).mount(root)
  return root.querySelector<HTMLElement>('.task-content')!
}

function fire(target: EventTarget, type: string, clientX: number, buttons: number): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons, clientX }))
}

afterEach(() => {
  app?.unmount()
  onComplete.mockClear()
  onRemove.mockClear()
  onOpen.mockClear()
  document.body.innerHTML = ''
})

describe('TaskRow swipe', () => {
  it('a swipe to the left removes the task and never completes it', async () => {
    const content = mountRow()
    fire(content, 'pointerdown', 300, 1)
    fire(content, 'pointermove', 150, 1)
    fire(content, 'pointerup', 150, 0)
    expect(onRemove).toHaveBeenCalledOnce()
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('a swipe that stops short of the end removes nothing', async () => {
    const content = mountRow()
    fire(content, 'pointerdown', 300, 1)
    fire(content, 'pointermove', 250, 1)
    fire(content, 'pointerup', 250, 0)
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('a tap on the text opens the task, the circle completes it, and a swipe is not a tap', async () => {
    const content = mountRow()
    content.querySelector<HTMLElement>('.task-text')!.click()
    expect(onOpen).toHaveBeenCalledOnce()
    content.querySelector<HTMLElement>('.check')!.click()
    expect(onComplete).toHaveBeenCalledOnce()

    onOpen.mockClear()
    fire(content, 'pointerdown', 300, 1)
    fire(content, 'pointermove', 250, 1)
    fire(content, 'pointerup', 250, 0)
    content.querySelector<HTMLElement>('.task-text')!.click()
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('has no delete button of its own: removing is a swipe or the task sheet', async () => {
    const content = mountRow()
    expect(content.querySelector('.remove')).toBeNull()
    expect(content.querySelectorAll('button')).toHaveLength(2)
  })

  it('ignores hover after a press released outside the row, and the next click does not complete it', async () => {
    const content = mountRow()
    fire(content, 'pointerdown', 300, 1)
    fire(document.body, 'pointerup', 300, 0)
    fire(content, 'pointermove', 150, 0)
    await nextTick()
    expect(content.style.transform).toBe('translateX(0px)')
    fire(content, 'pointerup', 150, 0)
    expect(onRemove).not.toHaveBeenCalled()
  })

  it('treats a move without the button as hover even when the release was never seen', async () => {
    const content = mountRow()
    fire(content, 'pointerdown', 300, 1)
    fire(content, 'pointermove', 280, 0)
    fire(content, 'pointermove', 100, 1)
    fire(content, 'pointerup', 100, 0)
    await nextTick()
    expect(content.style.transform).toBe('translateX(0px)')
    expect(onRemove).not.toHaveBeenCalled()
  })
})
