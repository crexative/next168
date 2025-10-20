export default {
  app: {
    title: 'Next168',
    tagline: 'Maîtrisez vos prochaines 168 heures.'
  },
  nav: {
    calendar: 'Calendrier',
    categories: 'Catégories',
    statistics: 'Statistiques'
  },
  common: {
    add: 'Ajouter',
    edit: 'Modifier',
    delete: 'Supprimer',
    cancel: 'Annuler',
    save: 'Enregistrer',
    update: 'Mettre à jour',
    close: 'Fermer',
    confirm: 'Confirmer',
    hours: 'heures',
    hour: 'heure',
    minutes: 'minutes',
    blocks: 'blocs',
    active: 'actives',
    today: "Aujourd'hui",
    random: 'Aléatoire'
  },
  calendar: {
    title: 'Calendrier Hebdomadaire',
    addBlock: 'Ajouter un Bloc de Temps',
    editBlock: 'Modifier le Bloc de Temps',
    noBlocks: 'Aucun bloc programmé',
    noBlocksDay: 'Aucun bloc programmé pour ce jour',
    addFirstBlock: 'Ajoutez Votre Premier Bloc',
    fields: {
      title: 'Titre',
      titlePlaceholder: 'ex., Réunion d\'Équipe, Gym',
      description: 'Description (optionnel)',
      descriptionPlaceholder: 'Ajoutez des notes ou des détails...',
      category: 'Catégorie',
      categoryPlaceholder: 'Sélectionnez une catégorie',
      day: 'Jour',
      startTime: 'Heure de Début',
      endTime: 'Heure de Fin',
      repeatDays: 'Répéter les Jours',
      repeatDaysHint: 'Sélectionnez plusieurs jours pour ce bloc'
    },
    days: {
      sunday: 'Dimanche',
      monday: 'Lundi',
      tuesday: 'Mardi',
      wednesday: 'Mercredi',
      thursday: 'Jeudi',
      friday: 'Vendredi',
      saturday: 'Samedi'
    },
    deleteConfirm: 'Êtes-vous sûr de vouloir supprimer "{title}" ?'
  },
  categories: {
    title: 'Catégories',
    addCategory: 'Ajouter une Catégorie',
    editCategory: 'Modifier la Catégorie',
    noCategories: 'Pas encore de catégories',
    noCategoriesDesc: 'Ajoutez votre première catégorie pour commencer à suivre votre temps !',
    fields: {
      name: 'Nom',
      namePlaceholder: 'ex., Travail, Exercice, Apprentissage',
      nameRequired: 'Nom *',
      icon: 'Icône',
      iconRequired: 'Icône *',
      color: 'Couleur',
      colorRequired: 'Couleur *',
      weeklyLimit: 'Limite d\'Heures Hebdomadaires',
      weeklyLimitRequired: 'Limite d\'Heures Hebdomadaires *',
      weeklyLimitHint: 'Maximum d\'heures par semaine (0.5 - 168)'
    },
    stats: {
      weeklyLimit: 'Limite Hebdomadaire :',
      used: 'Utilisé :',
      remaining: 'Restant :',
      ofLimit: 'de la limite'
    },
    selected: 'Sélectionné',
    deleteConfirm: 'Êtes-vous sûr de vouloir supprimer "{name}" ? Cette action ne peut pas être annulée.'
  },
  statistics: {
    title: 'Statistiques',
    scheduledHours: 'Heures Programmées',
    availableHours: 'Heures Disponibles',
    totalBlocks: 'Total des Blocs',
    categoriesCount: 'Catégories',
    categoryBreakdown: 'Répartition par Catégorie',
    dailyDistribution: 'Distribution Quotidienne',
    weekUtilization: 'Utilisation Hebdomadaire',
    noCategories: 'Pas encore de catégories avec du temps programmé',
    utilizationText: 'Vous avez programmé <strong>{scheduled} heures</strong> sur <strong>{total} heures</strong> cette semaine (<strong>{percentage}%</strong>).',
    availableText: 'Il reste encore <strong>{available} heures</strong> disponibles à planifier.',
    scheduled: 'Programmé',
    available: 'Disponible',
    chartLabel: 'Heures'
  },
  footer: {
    text: 'Next168 - Planifiez vos prochaines 168 heures, sans effort'
  },
  errors: {
    categoryNotFound: 'Catégorie introuvable',
    timeBlockNotFound: 'Bloc de temps introuvable',
    cannotDeleteCategory: 'Impossible de supprimer la catégorie avec {count} blocs de temps programmés',
    cannotReduceLimit: 'Impossible de réduire la limite en dessous de l\'utilisation actuelle ({hours} heures programmées)',
    invalidTime: 'Format d\'heure invalide',
    overlapDetected: 'Le bloc de temps chevauche un bloc existant',
    categoryLimitExceeded: 'L\'ajout de ce bloc dépasserait la limite de la catégorie'
  },
  defaultCategories: {
    sleep: 'Sommeil',
    work: 'Travail',
    exercise: 'Exercice',
    learning: 'Apprentissage',
    personalProjects: 'Projets Personnels'
  },
  tutorial: {
    skip: 'Passer',
    next: 'Suivant',
    previous: 'Précédent',
    getStarted: 'Commencer',
    step1: {
      title: 'Maîtrisez Vos 168 Heures',
      description: 'Chaque semaine compte exactement 168 heures. Next168 vous aide à visualiser et planifier comment les utiliser efficacement.',
      feature1: 'Voyez toute votre semaine en un coup d\'œil',
      feature2: 'Suivez le temps dans tous les domaines de votre vie',
      feature3: 'Ne vous demandez plus jamais où est passé votre temps'
    },
    step2: {
      title: 'Créez des Catégories Intelligentes',
      description: 'Organisez votre temps avec des catégories personnalisées. Définissez des limites d\'heures hebdomadaires et suivez vos progrès.',
      feature1: 'Travail, Exercice, Apprentissage, Sommeil et plus',
      feature2: 'Définissez des limites d\'heures réalistes pour chaque catégorie',
      feature3: 'De belles icônes et couleurs pour rester organisé'
    },
    step3: {
      title: 'Planifiez des Blocs de Temps',
      description: 'Ajoutez des blocs de temps à votre semaine et regardez votre emploi du temps prendre vie. Répétez les blocs sur plusieurs jours en un clic.',
      feature1: 'Création rapide et facile de blocs de temps',
      feature2: 'Répétez les blocs sur plusieurs jours (Lun-Ven)',
      feature3: 'Détection automatique des chevauchements'
    },
    step4: {
      title: 'Visualisez Votre Semaine',
      description: 'Obtenez des informations avec de beaux graphiques et statistiques. Voyez comment vous utilisez vos 168 heures.',
      feature1: 'Graphiques et tableaux interactifs',
      feature2: 'Répartition par catégorie et barres de progression',
      feature3: 'Métriques d\'utilisation hebdomadaire'
    }
  }
}
