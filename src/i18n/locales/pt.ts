export default {
  app: {
    title: 'Next168',
    tagline: 'Domine suas próximas 168 horas.'
  },
  nav: {
    calendar: 'Calendário',
    categories: 'Categorias',
    statistics: 'Estatísticas'
  },
  common: {
    add: 'Adicionar',
    edit: 'Editar',
    delete: 'Excluir',
    cancel: 'Cancelar',
    save: 'Salvar',
    update: 'Atualizar',
    close: 'Fechar',
    confirm: 'Confirmar',
    hours: 'horas',
    hour: 'hora',
    minutes: 'minutos',
    blocks: 'blocos',
    active: 'ativas',
    today: 'Hoje',
    random: 'Aleatório'
  },
  calendar: {
    title: 'Calendário Semanal',
    addBlock: 'Adicionar Bloco de Tempo',
    editBlock: 'Editar Bloco de Tempo',
    noBlocks: 'Nenhum bloco agendado',
    noBlocksDay: 'Nenhum bloco agendado para este dia',
    addFirstBlock: 'Adicione Seu Primeiro Bloco',
    fields: {
      title: 'Título',
      titlePlaceholder: 'ex., Reunião de Equipe, Academia',
      description: 'Descrição (opcional)',
      descriptionPlaceholder: 'Adicione notas ou detalhes...',
      category: 'Categoria',
      categoryPlaceholder: 'Selecione uma categoria',
      day: 'Dia',
      startTime: 'Hora de Início',
      endTime: 'Hora de Término'
    },
    days: {
      sunday: 'Domingo',
      monday: 'Segunda-feira',
      tuesday: 'Terça-feira',
      wednesday: 'Quarta-feira',
      thursday: 'Quinta-feira',
      friday: 'Sexta-feira',
      saturday: 'Sábado'
    },
    deleteConfirm: 'Tem certeza de que deseja excluir "{title}"?'
  },
  categories: {
    title: 'Categorias',
    addCategory: 'Adicionar Categoria',
    editCategory: 'Editar Categoria',
    noCategories: 'Ainda não há categorias',
    noCategoriesDesc: 'Adicione sua primeira categoria para começar a rastrear seu tempo!',
    fields: {
      name: 'Nome',
      namePlaceholder: 'ex., Trabalho, Exercício, Aprendizado',
      nameRequired: 'Nome *',
      icon: 'Ícone',
      iconRequired: 'Ícone *',
      color: 'Cor',
      colorRequired: 'Cor *',
      weeklyLimit: 'Limite de Horas Semanais',
      weeklyLimitRequired: 'Limite de Horas Semanais *',
      weeklyLimitHint: 'Máximo de horas por semana (0.5 - 168)'
    },
    stats: {
      weeklyLimit: 'Limite Semanal:',
      used: 'Usado:',
      remaining: 'Restante:',
      ofLimit: 'do limite'
    },
    selected: 'Selecionado',
    deleteConfirm: 'Tem certeza de que deseja excluir "{name}"? Esta ação não pode ser desfeita.'
  },
  statistics: {
    title: 'Estatísticas',
    scheduledHours: 'Horas Agendadas',
    availableHours: 'Horas Disponíveis',
    totalBlocks: 'Total de Blocos',
    categoriesCount: 'Categorias',
    categoryBreakdown: 'Detalhamento por Categoria',
    dailyDistribution: 'Distribuição Diária',
    weekUtilization: 'Utilização Semanal',
    noCategories: 'Ainda não há categorias com tempo agendado',
    utilizationText: 'Você agendou <strong>{scheduled} horas</strong> de <strong>{total} horas</strong> desta semana (<strong>{percentage}%</strong>).',
    availableText: 'Ainda há <strong>{available} horas</strong> disponíveis para planejar.',
    scheduled: 'Agendado',
    available: 'Disponível',
    chartLabel: 'Horas'
  },
  footer: {
    text: 'Next168 - Planeje suas próximas 168 horas, sem esforço'
  },
  errors: {
    categoryNotFound: 'Categoria não encontrada',
    timeBlockNotFound: 'Bloco de tempo não encontrado',
    cannotDeleteCategory: 'Não é possível excluir a categoria com {count} blocos de tempo agendados',
    cannotReduceLimit: 'Não é possível reduzir o limite abaixo do uso atual ({hours} horas agendadas)',
    invalidTime: 'Formato de hora inválido',
    overlapDetected: 'O bloco de tempo se sobrepõe a um bloco existente',
    categoryLimitExceeded: 'Adicionar este bloco excederia o limite da categoria'
  }
}
