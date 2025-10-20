export default {
  app: {
    title: 'Next168',
    tagline: 'Domina tus próximas 168 horas.'
  },
  nav: {
    calendar: 'Calendario',
    categories: 'Categorías',
    statistics: 'Estadísticas'
  },
  common: {
    add: 'Agregar',
    edit: 'Editar',
    delete: 'Eliminar',
    cancel: 'Cancelar',
    save: 'Guardar',
    update: 'Actualizar',
    close: 'Cerrar',
    confirm: 'Confirmar',
    hours: 'horas',
    hour: 'hora',
    minutes: 'minutos',
    blocks: 'bloques',
    active: 'activas',
    today: 'Hoy',
    random: 'Aleatorio'
  },
  calendar: {
    title: 'Calendario Semanal',
    addBlock: 'Agregar Bloque de Tiempo',
    editBlock: 'Editar Bloque de Tiempo',
    noBlocks: 'No hay bloques programados',
    noBlocksDay: 'No hay bloques programados para este día',
    addFirstBlock: 'Agrega Tu Primer Bloque',
    fields: {
      title: 'Título',
      titlePlaceholder: 'ej., Reunión de Equipo, Gimnasio',
      description: 'Descripción (opcional)',
      descriptionPlaceholder: 'Agrega notas o detalles...',
      category: 'Categoría',
      categoryPlaceholder: 'Selecciona una categoría',
      day: 'Día',
      startTime: 'Hora de Inicio',
      endTime: 'Hora de Fin'
    },
    days: {
      sunday: 'Domingo',
      monday: 'Lunes',
      tuesday: 'Martes',
      wednesday: 'Miércoles',
      thursday: 'Jueves',
      friday: 'Viernes',
      saturday: 'Sábado'
    },
    deleteConfirm: '¿Estás seguro de que quieres eliminar "{title}"?'
  },
  categories: {
    title: 'Categorías',
    addCategory: 'Agregar Categoría',
    editCategory: 'Editar Categoría',
    noCategories: 'Aún no hay categorías',
    noCategoriesDesc: '¡Agrega tu primera categoría para comenzar a rastrear tu tiempo!',
    fields: {
      name: 'Nombre',
      namePlaceholder: 'ej., Trabajo, Ejercicio, Aprendizaje',
      nameRequired: 'Nombre *',
      icon: 'Icono',
      iconRequired: 'Icono *',
      color: 'Color',
      colorRequired: 'Color *',
      weeklyLimit: 'Límite de Horas Semanales',
      weeklyLimitRequired: 'Límite de Horas Semanales *',
      weeklyLimitHint: 'Máximo de horas por semana (0.5 - 168)'
    },
    stats: {
      weeklyLimit: 'Límite Semanal:',
      used: 'Usado:',
      remaining: 'Restante:',
      ofLimit: 'del límite'
    },
    selected: 'Seleccionado',
    deleteConfirm: '¿Estás seguro de que quieres eliminar "{name}"? Esta acción no se puede deshacer.'
  },
  statistics: {
    title: 'Estadísticas',
    scheduledHours: 'Horas Programadas',
    availableHours: 'Horas Disponibles',
    totalBlocks: 'Total de Bloques',
    categoriesCount: 'Categorías',
    categoryBreakdown: 'Desglose por Categoría',
    dailyDistribution: 'Distribución Diaria',
    weekUtilization: 'Utilización Semanal',
    noCategories: 'Aún no hay categorías con tiempo programado',
    utilizationText: 'Has programado <strong>{scheduled} horas</strong> de <strong>{total} horas</strong> esta semana (<strong>{percentage}%</strong>).',
    availableText: 'Todavía hay <strong>{available} horas</strong> disponibles para planificar.',
    scheduled: 'Programado',
    available: 'Disponible',
    chartLabel: 'Horas'
  },
  footer: {
    text: 'Next168 - Planifica tus próximas 168 horas, sin esfuerzo'
  },
  errors: {
    categoryNotFound: 'Categoría no encontrada',
    timeBlockNotFound: 'Bloque de tiempo no encontrado',
    cannotDeleteCategory: 'No se puede eliminar la categoría con {count} bloques de tiempo programados',
    cannotReduceLimit: 'No se puede reducir el límite por debajo del uso actual ({hours} horas programadas)',
    invalidTime: 'Formato de hora inválido',
    overlapDetected: 'El bloque de tiempo se superpone con uno existente',
    categoryLimitExceeded: 'Agregar este bloque excedería el límite de la categoría'
  }
}
