// Keyword fragments are matched against accent-stripped, lowercase text, in every locale at once:
// people ask in a language other than the interface language often enough.

export type Intent = 'nextBlock' | 'overflow' | 'unassigned' | 'remaining' | 'hours' | 'change'

export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

const LEXICON: Record<Exclude<Intent, 'hours'>, string[]> = {
  nextBlock: [
    'next block', 'next event', 'what is next', "what's next", 'up next', 'whats next',
    'proximo bloque', 'siguiente bloque', 'que sigue', 'lo siguiente',
    'prochain bloc', 'prochain', 'ensuite',
    'proximo bloco', 'seguinte',
    'nachster block', 'nachste', 'als nachstes',
  ],
  overflow: [
    'overflow', 'do not fit', "don't fit", 'dont fit', 'not fit', 'no room', 'overdue', 'late task',
    'desbord', 'no caben', 'no cabe', 'no encajan', 'sin hueco',
    'debord', 'ne rentrent', 'ne tiennent', 'pas de place', 'en retard',
    'transbord', 'nao cabem', 'nao cabe', 'nao encaixam', 'sem espaco',
    'uberlauf', 'passen nicht', 'passt nicht', 'kein platz', 'uberfallig',
  ],
  unassigned: [
    'unassigned', 'unplanned', 'unscheduled', 'free hours', 'hours free', 'hours left', 'not planned',
    'sin asignar', 'sin planificar', 'horas libres', 'libres',
    'non assigne', 'non planifie', 'heures libres',
    'nao atribu', 'sem atribuir', 'nao planejad', 'horas livres', 'livres',
    'nicht zugewiesen', 'nicht verplant', 'freie stunden', 'unverplant',
  ],
  remaining: [
    'remaining', 'goal', 'target', 'limit', 'still', 'left for', 'left in', 'left on', 'to reach',
    'restan', 'quedan', 'queda', 'meta', 'objetivo', 'limite', 'faltan', 'falta',
    'reste', 'restant', 'objectif', 'manque',
    'restam', 'restante', 'faltam', 'meta',
    'ubrig', 'verbleib', 'ziel', 'fehlen', 'fehlt', 'bleiben',
  ],
  change: [
    'add ', 'move ', 'delete ', 'remove ', 'schedule ', 'reschedule', 'change ', 'create ', 'cancel ', 'plan ',
    'anade', 'agrega', 'mueve', 'mover', 'elimina', 'borra', 'programa', 'cambia', 'crea ', 'cancela',
    'ajoute', 'deplace', 'supprime', 'planifie', 'modifie', 'cree', 'annule',
    'adiciona', 'mova', 'exclui', 'apaga', 'agenda', 'altera', 'cria ', 'cancele',
    'hinzu', 'verschieb', 'losch', 'plane ', 'andere', 'erstelle', 'storniere',
  ],
}

const HOURS_WORDS = ['hour', 'horas', 'heure', 'stunde', ' h ']

export function matchesIntent(intent: Exclude<Intent, 'hours'>, question: string): boolean {
  const text = ` ${normalize(question)} `
  return LEXICON[intent].some((fragment) => text.includes(fragment))
}

export function mentionsHours(question: string): boolean {
  const text = ` ${normalize(question)} `
  return HOURS_WORDS.some((word) => text.includes(word))
}
