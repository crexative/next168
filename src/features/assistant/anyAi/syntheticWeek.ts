// A synthetic week the size of a real one moved from another planner: 8 categories, 85 routine ranges (overnight sleep
// included) covering all 168 hours, and 3 tasks. Written in Spanish like the person who would paste it. It contains no
// one's private data. Unit tests and the end-to-end test both use it, so it imports nothing from the app.

export interface SyntheticCategory { ref: string; name: string; goal: { type: 'max' | 'min' | 'none'; hoursPerWeek: number } }
export interface SyntheticRange { title: string; category: string; days: number[]; start: number; end: number }
export interface SyntheticTask { title: string; category: string; durationMin: number; priority: 1 | 2 | 3 }

const hm = (text: string) => { const [h, m] = text.split(':').map(Number); return h! * 60 + m! }
const WEEKDAYS = [1, 2, 3, 4, 5]

export const SYNTHETIC_CATEGORIES: SyntheticCategory[] = [
  { ref: 'new-sleep', name: 'Sueño', goal: { type: 'min', hoursPerWeek: 56 } },
  { ref: 'new-work', name: 'Trabajo', goal: { type: 'max', hoursPerWeek: 40 } },
  { ref: 'new-exercise', name: 'Ejercicio', goal: { type: 'min', hoursPerWeek: 4.5 } },
  { ref: 'new-food', name: 'Comer y cocinar', goal: { type: 'max', hoursPerWeek: 14 } },
  { ref: 'new-project', name: 'Proyecto personal', goal: { type: 'max', hoursPerWeek: 12 } },
  { ref: 'new-social', name: 'Familia y amigos', goal: { type: 'min', hoursPerWeek: 15 } },
  { ref: 'new-learning', name: 'Aprender', goal: { type: 'min', hoursPerWeek: 6 } },
  { ref: 'new-routines', name: 'Rutinas y casa', goal: { type: 'none', hoursPerWeek: 0 } },
]

const range = (title: string, category: string, days: number[], start: string, end: string): SyntheticRange => ({ title, category, days, start: hm(start), end: hm(end) })

// Grouped the way a chat AI groups them: one entry per title and time, with every day it repeats on.
export const SYNTHETIC_ROUTINE: SyntheticRange[] = [
  range('Desayuno', 'new-food', WEEKDAYS, '06:30', '07:00'),
  range('Proyecto: foco', 'new-project', WEEKDAYS, '07:00', '08:30'),
  range('Revisar correo', 'new-work', WEEKDAYS, '08:30', '09:00'),
  range('Trabajo', 'new-work', WEEKDAYS, '09:00', '12:30'),
  range('Almuerzo', 'new-food', WEEKDAYS, '12:30', '13:15'),
  range('Trabajo', 'new-work', WEEKDAYS, '13:15', '15:00'),
  range('Pausa activa', 'new-exercise', WEEKDAYS, '15:00', '15:15'),
  range('Trabajo', 'new-work', WEEKDAYS, '15:15', '17:30'),
  range('Gimnasio', 'new-exercise', [1, 3, 5], '17:30', '18:30'),
  range('Caminar', 'new-exercise', [2, 4], '17:30', '18:30'),
  range('Cena y cocina', 'new-food', WEEKDAYS, '18:30', '19:30'),
  range('Clase de inglés', 'new-learning', [1, 2, 3, 4], '19:30', '21:00'),
  range('Familia', 'new-social', [1, 2, 3, 4], '21:00', '22:00'),
  range('Rutina de noche', 'new-routines', [1, 2, 3, 4], '22:00', '22:30'),
  range('Dormir', 'new-sleep', [0, 1, 2, 3, 4], '22:30', '06:30'),
  range('Amigos', 'new-social', [5], '19:30', '22:30'),
  range('Rutina de noche', 'new-routines', [5], '22:30', '23:00'),
  range('Dormir', 'new-sleep', [5, 6], '23:00', '08:00'),
  range('Desayuno', 'new-food', [6], '08:00', '08:45'),
  range('Correr largo', 'new-exercise', [6], '08:45', '10:15'),
  range('Mercado y casa', 'new-routines', [6], '10:15', '12:15'),
  range('Almuerzo', 'new-food', [6], '12:15', '13:30'),
  range('Proyecto: avanzar', 'new-project', [6], '13:30', '17:30'),
  range('Salir con amigos', 'new-social', [6], '17:30', '23:00'),
  range('Desayuno largo', 'new-food', [0], '08:00', '09:00'),
  range('Tiempo libre', 'new-social', [0], '09:00', '12:00'),
  range('Almuerzo familiar', 'new-social', [0], '12:00', '13:30'),
  range('Leer', 'new-learning', [0], '13:30', '16:30'),
  range('Planear la semana', 'new-routines', [0], '16:30', '18:00'),
  range('Cocinar para la semana', 'new-food', [0], '18:00', '19:30'),
  range('Familia', 'new-social', [0], '19:30', '22:00'),
  range('Rutina de noche', 'new-routines', [0], '22:00', '22:30'),
]

export const SYNTHETIC_TASKS: SyntheticTask[] = [
  { title: 'Medir la cintura', category: 'new-routines', durationMin: 15, priority: 3 },
  { title: 'Reservar clases de natación', category: 'new-exercise', durationMin: 15, priority: 3 },
  { title: 'Confirmar cantidades del mercado', category: 'new-food', durationMin: 15, priority: 2 },
]

export const SYNTHETIC_RANGE_COUNT = SYNTHETIC_ROUTINE.reduce((sum, item) => sum + item.days.length, 0)

// The proposal a chat AI sends for an empty Weeklid: create the categories, then the routine and tasks that use them.
export function syntheticWeekProposal(workspaceId: string, baseRevision: number) {
  return {
    contractVersion: '1.0' as const, workspaceId, baseRevision,
    summary: 'Trasladar las categorías, la rutina semanal y los pendientes desde el otro planner',
    ops: [
      ...SYNTHETIC_CATEGORIES.map(({ ref, name, goal }) => ({ op: 'add_category' as const, ref, category: goal.type === 'none' ? { name } : { name, goal } })),
      ...SYNTHETIC_ROUTINE.map(({ title, category, days, start, end }) => ({ op: 'add_block' as const, block: { categoryId: category, title, days, start, end } })),
      ...SYNTHETIC_TASKS.map(({ title, category, durationMin, priority }) => ({ op: 'add_task' as const, task: { title, categoryId: category, durationMin, priority } })),
    ],
  }
}

// What the reply looks like in a chat window: prose, a summary table, one weeklid block and a closing note.
export function syntheticWeekReply(workspaceId: string, baseRevision: number): string {
  const proposal = syntheticWeekProposal(workspaceId, baseRevision)
  const lines = proposal.ops.map((op) => JSON.stringify(op)).join(',\n')
  const opening = JSON.stringify({ ...proposal, ops: undefined }).slice(0, -1)
  return `Te dejo el traslado completo en una sola propuesta de ${proposal.ops.length} cambios. Como tu plan está vacío, primero creo las 8 categorías y después la rutina y los pendientes las usan.

- **Categorías:** ${SYNTHETIC_CATEGORIES.map((category) => category.name).join(', ')}.
- **Rutina:** ${SYNTHETIC_RANGE_COUNT} franjas de lunes a domingo, agrupando los días que se repiten.
- **Pendientes:** las 3 tareas, de 15 minutos cada una.

| Categoría | Meta |
|---|---|
| Sueño | al menos 56 h |
| Trabajo | como máximo 40 h |

Los bloques de dormir cruzan la medianoche, así que su fin es menor que su inicio.

\`\`\`weeklid
${opening},"ops":[
${lines}
]}
\`\`\`

Revisa los cambios en Weeklid y apruébalos si todo está bien. ¿Quieres que luego ajuste algo del fin de semana?`
}
