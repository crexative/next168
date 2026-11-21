import { nextTick } from 'vue'

// "Durante" in Nueva tarea and Editar tarea is a row that opens its choices in place (radios), so these read and pick
// the choice the way a person does: the checked radio, the choices in order, and a click on one.
const radios = (root: ParentNode) => [...root.querySelectorAll<HTMLInputElement>('[data-testid=task-when] input[type=radio]')]

export function whenValue(root: ParentNode): string | undefined {
  return radios(root).find((radio) => radio.checked)?.value
}

export function whenValues(root: ParentNode): string[] {
  return radios(root).map((radio) => radio.value)
}

export function whenNames(root: ParentNode): string[] {
  return radios(root).map((radio) => radio.closest('label')!.textContent!.trim())
}

export async function pickWhen(root: ParentNode, id: string): Promise<void> {
  root.querySelector<HTMLButtonElement>('[data-testid=task-when-toggle]')!.click()
  await nextTick()
  radios(root).find((radio) => radio.value === id)!.click()
  await nextTick()
}
