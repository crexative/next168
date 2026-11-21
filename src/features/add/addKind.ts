// What the shell's "+" can add: a task, a one-off event or a repeating routine (a time block of the week).
export type AddKind = 'task' | 'event' | 'block'

export const ADD_KINDS: readonly AddKind[] = ['task', 'event', 'block']
