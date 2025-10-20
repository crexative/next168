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
      endTime: 'Hora de Fin',
      repeatDays: 'Repetir en Días',
      repeatDaysHint: 'Selecciona múltiples días para este bloque'
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
  },
  defaultCategories: {
    sleep: 'Sueño',
    work: 'Trabajo',
    exercise: 'Ejercicio',
    learning: 'Aprendizaje',
    personalProjects: 'Proyectos Personales'
  },
  tutorial: {
    skip: 'Saltar',
    next: 'Siguiente',
    previous: 'Anterior',
    getStarted: 'Comenzar',
    step1: {
      title: 'Domina Tus 168 Horas',
      description: 'Cada semana tiene exactamente 168 horas. Next168 te ayuda a visualizar y planificar cómo usarlas eficazmente.',
      feature1: 'Ve toda tu semana de un vistazo',
      feature2: 'Rastrea el tiempo en todas las áreas de tu vida',
      feature3: 'Nunca te preguntes dónde fue tu tiempo'
    },
    step2: {
      title: 'Crea Categorías Inteligentes',
      description: 'Organiza tu tiempo con categorías personalizadas. Establece límites de horas semanales y rastrea tu progreso.',
      feature1: 'Trabajo, Ejercicio, Aprendizaje, Sueño y más',
      feature2: 'Establece límites de horas realistas para cada categoría',
      feature3: 'Hermosos íconos y colores para mantenerte organizado'
    },
    step3: {
      title: 'Programa Bloques de Tiempo',
      description: 'Agrega bloques de tiempo a tu semana y observa cómo cobra vida tu horario. Repite bloques en múltiples días con un clic.',
      feature1: 'Creación rápida y fácil de bloques de tiempo',
      feature2: 'Repite bloques en múltiples días (Lun-Vie)',
      feature3: 'Detección automática de superposiciones'
    },
    step4: {
      title: 'Visualiza Tu Semana',
      description: 'Obtén información con hermosos gráficos y estadísticas. Ve cómo estás usando tus 168 horas.',
      feature1: 'Gráficos y tablas interactivas',
      feature2: 'Desglose por categoría y barras de progreso',
      feature3: 'Métricas de utilización semanal'
    }
  }
}
