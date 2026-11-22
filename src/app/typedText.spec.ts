import { afterEach, expect, it } from 'vitest'
import { trackTypedText } from './typedText'

afterEach(() => { document.body.innerHTML = '' })

function sheetWith(html: string): HTMLElement {
  const sheet = document.createElement('section')
  sheet.innerHTML = html
  document.body.append(sheet)
  return sheet
}

it('a field counts once it holds something other than when it took focus, and only while on screen', () => {
  const sheet = sheetWith('<input id="name" value="Gym"><textarea id="reply"></textarea><input id="ro" readonly>')
  const typed = trackTypedText()
  const stop = typed.watch(() => sheet)
  const name = sheet.querySelector<HTMLInputElement>('#name')!
  const reply = sheet.querySelector<HTMLTextAreaElement>('#reply')!
  name.focus()
  expect(typed.changedField()).toBeUndefined()
  name.value = 'Gym '
  expect(typed.changedField()).toBeUndefined()
  reply.focus()
  reply.value = 'pasted answer'
  expect(typed.changedField()).toBe(reply)
  reply.remove()
  expect(typed.changedField()).toBeUndefined()
  name.value = 'Gimnasio'
  expect(typed.changedField()).toBe(name)
  typed.reset()
  expect(typed.changedField()).toBeUndefined()
  stop()
})

it('ignores fields outside the sheet and read-only ones', () => {
  const sheet = sheetWith('<input id="ro" readonly>')
  const outside = document.body.appendChild(document.createElement('input'))
  const typed = trackTypedText()
  const stop = typed.watch(() => sheet)
  outside.focus()
  outside.value = 'elsewhere'
  const readOnly = sheet.querySelector<HTMLInputElement>('#ro')!
  readOnly.focus()
  readOnly.value = 'x'
  expect(typed.changedField()).toBeUndefined()
  stop()
})

it('a field that saves itself on change (a calendar\'s name) never counts as unsaved', () => {
  const sheet = sheetWith('<input id="calendar" value="Work" data-saves-on-change>')
  const typed = trackTypedText()
  const stop = typed.watch(() => sheet)
  const field = sheet.querySelector<HTMLInputElement>('#calendar')!
  field.focus()
  field.value = 'Personal'
  expect(typed.changedField()).toBeUndefined()
  stop()
})
