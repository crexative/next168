export default {
  app: {
    title: 'Next168',
    tagline: 'Meistern Sie Ihre nächsten 168 Stunden.'
  },
  nav: {
    calendar: 'Kalender',
    categories: 'Kategorien',
    statistics: 'Statistiken'
  },
  common: {
    add: 'Hinzufügen',
    edit: 'Bearbeiten',
    delete: 'Löschen',
    cancel: 'Abbrechen',
    save: 'Speichern',
    update: 'Aktualisieren',
    close: 'Schließen',
    confirm: 'Bestätigen',
    hours: 'Stunden',
    hour: 'Stunde',
    minutes: 'Minuten',
    blocks: 'Blöcke',
    active: 'aktiv',
    today: 'Heute',
    random: 'Zufällig'
  },
  calendar: {
    title: 'Wochenkalender',
    addBlock: 'Zeitblock Hinzufügen',
    editBlock: 'Zeitblock Bearbeiten',
    noBlocks: 'Keine Blöcke geplant',
    noBlocksDay: 'Keine Blöcke für diesen Tag geplant',
    addFirstBlock: 'Fügen Sie Ihren Ersten Block Hinzu',
    fields: {
      title: 'Titel',
      titlePlaceholder: 'z.B., Team-Meeting, Fitnessstudio',
      description: 'Beschreibung (optional)',
      descriptionPlaceholder: 'Notizen oder Details hinzufügen...',
      category: 'Kategorie',
      categoryPlaceholder: 'Wählen Sie eine Kategorie',
      day: 'Tag',
      startTime: 'Startzeit',
      endTime: 'Endzeit'
    },
    days: {
      sunday: 'Sonntag',
      monday: 'Montag',
      tuesday: 'Dienstag',
      wednesday: 'Mittwoch',
      thursday: 'Donnerstag',
      friday: 'Freitag',
      saturday: 'Samstag'
    },
    deleteConfirm: 'Sind Sie sicher, dass Sie "{title}" löschen möchten?'
  },
  categories: {
    title: 'Kategorien',
    addCategory: 'Kategorie Hinzufügen',
    editCategory: 'Kategorie Bearbeiten',
    noCategories: 'Noch keine Kategorien',
    noCategoriesDesc: 'Fügen Sie Ihre erste Kategorie hinzu, um Ihre Zeit zu verfolgen!',
    fields: {
      name: 'Name',
      namePlaceholder: 'z.B., Arbeit, Sport, Lernen',
      nameRequired: 'Name *',
      icon: 'Symbol',
      iconRequired: 'Symbol *',
      color: 'Farbe',
      colorRequired: 'Farbe *',
      weeklyLimit: 'Wöchentliches Stundenlimit',
      weeklyLimitRequired: 'Wöchentliches Stundenlimit *',
      weeklyLimitHint: 'Maximale Stunden pro Woche (0.5 - 168)'
    },
    stats: {
      weeklyLimit: 'Wöchentliches Limit:',
      used: 'Verwendet:',
      remaining: 'Verbleibend:',
      ofLimit: 'des Limits'
    },
    selected: 'Ausgewählt',
    deleteConfirm: 'Sind Sie sicher, dass Sie "{name}" löschen möchten? Diese Aktion kann nicht rückgängig gemacht werden.'
  },
  statistics: {
    title: 'Statistiken',
    scheduledHours: 'Geplante Stunden',
    availableHours: 'Verfügbare Stunden',
    totalBlocks: 'Gesamte Blöcke',
    categoriesCount: 'Kategorien',
    categoryBreakdown: 'Aufschlüsselung nach Kategorie',
    dailyDistribution: 'Tägliche Verteilung',
    weekUtilization: 'Wochenauslastung',
    noCategories: 'Noch keine Kategorien mit geplanter Zeit',
    utilizationText: 'Sie haben <strong>{scheduled} Stunden</strong> von <strong>{total} Stunden</strong> diese Woche geplant (<strong>{percentage}%</strong>).',
    availableText: 'Es sind noch <strong>{available} Stunden</strong> zum Planen verfügbar.',
    scheduled: 'Geplant',
    available: 'Verfügbar',
    chartLabel: 'Stunden'
  },
  footer: {
    text: 'Next168 - Planen Sie Ihre nächsten 168 Stunden, mühelos'
  },
  errors: {
    categoryNotFound: 'Kategorie nicht gefunden',
    timeBlockNotFound: 'Zeitblock nicht gefunden',
    cannotDeleteCategory: 'Kategorie mit {count} geplanten Zeitblöcken kann nicht gelöscht werden',
    cannotReduceLimit: 'Limit kann nicht unter die aktuelle Nutzung reduziert werden ({hours} Stunden geplant)',
    invalidTime: 'Ungültiges Zeitformat',
    overlapDetected: 'Zeitblock überlappt mit bestehendem Block',
    categoryLimitExceeded: 'Das Hinzufügen dieses Blocks würde das Kategorienlimit überschreiten'
  }
}
