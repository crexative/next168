import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'
import { createI18n } from 'vue-i18n'
import TaskRow from './TaskRow.vue'

let app: ReturnType<typeof createApp> | undefined
const onComplete = vi.fn()

function mountRow(): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  app = createApp({ render: () => h('ul', [h(TaskRow, { title: 'Report', color: 'red', completeLabel: 'Complete', removeLabel: 'Remove', onComplete })]) })
  app.use(createI18n({ legacy: false, locale: 'en', messages: { en: { tasks: { swipeComplete: 'Done' } } } })).mount(root)
  return root.querySelector<HTMLElement>('.task-content')!
}

function fire(target: EventTarget, type: string, clientX: number, buttons: number): void {
  target.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 1, pointerType: 'mouse', buttons, clientX }))
}

afterEach(() => {
  app?.unmount()
  onComplete.mockClear()
  document.body.innerHTML = ''
})

describe('TaskRow swipe', () => {
  it('a swipe completes the task', async () => {
    const content = mountRow()
    fire(content, 'pointerdown', 300, 1)
    fire(content, 'pointermove', 150, 1)
    fire(content, 'pointerup', 150, 0)
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it('ignores hover after a press released outside the row, and the next click does not complete it', async () => {
    const content = mountRow()
    fire(content, 'pointerdown', 300, 1)
    fire(document.body, 'pointerup', 300, 0)
    fire(content, 'pointermove', 150, 0)
    await nextTick()
    expect(content.style.transform).toBe('translateX(0px)')
    fire(content, 'pointerup', 150, 0)
    expect(onComplete).not.toHaveBeenCalled()
  })

  it('treats a move without the button as hover even when the release was never seen', async () => {
    const content = mountRow()
    fire(content, 'pointerdown', 300, 1)
    fire(content, 'pointermove', 280, 0)
    fire(content, 'pointermove', 100, 1)
    fire(content, 'pointerup', 100, 0)
    await nextTick()
    expect(content.style.transform).toBe('translateX(0px)')
    expect(onComplete).not.toHaveBeenCalled()
  })
})
