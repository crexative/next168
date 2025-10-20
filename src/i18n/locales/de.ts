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
      endTime: 'Endzeit',
      repeatDays: 'An Tagen Wiederholen',
      repeatDaysHint: 'Wählen Sie mehrere Tage für diesen Block'
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
  },
  defaultCategories: {
    sleep: 'Schlaf',
    work: 'Arbeit',
    exercise: 'Bewegung',
    learning: 'Lernen',
    personalProjects: 'Persönliche Projekte'
  },
  tutorial: {
    skip: 'Überspringen',
    next: 'Weiter',
    previous: 'Zurück',
    getStarted: 'Loslegen',
    step1: {
      title: 'Meistern Sie Ihre 168 Stunden',
      description: 'Jede Woche hat genau 168 Stunden. Next168 hilft Ihnen, zu visualisieren und zu planen, wie Sie diese effektiv nutzen.',
      feature1: 'Sehen Sie Ihre ganze Woche auf einen Blick',
      feature2: 'Verfolgen Sie die Zeit in allen Lebensbereichen',
      feature3: 'Fragen Sie sich nie wieder, wo Ihre Zeit geblieben ist'
    },
    step2: {
      title: 'Erstellen Sie Intelligente Kategorien',
      description: 'Organisieren Sie Ihre Zeit mit benutzerdefinierten Kategorien. Legen Sie wöchentliche Stundenlimits fest und verfolgen Sie Ihren Fortschritt.',
      feature1: 'Arbeit, Bewegung, Lernen, Schlaf und mehr',
      feature2: 'Setzen Sie realistische Stundenlimits für jede Kategorie',
      feature3: 'Schöne Symbole und Farben für Organisation'
    },
    step3: {
      title: 'Planen Sie Zeitblöcke',
      description: 'Fügen Sie Zeitblöcke zu Ihrer Woche hinzu und sehen Sie, wie Ihr Zeitplan zum Leben erwacht. Wiederholen Sie Blöcke über mehrere Tage mit einem Klick.',
      feature1: 'Schnelle und einfache Zeitblockerstellung',
      feature2: 'Wiederholen Sie Blöcke an mehreren Tagen (Mo-Fr)',
      feature3: 'Automatische Überschneidungserkennung'
    },
    step4: {
      title: 'Visualisieren Sie Ihre Woche',
      description: 'Erhalten Sie Einblicke mit schönen Diagrammen und Statistiken. Sehen Sie, wie Sie Ihre 168 Stunden nutzen.',
      feature1: 'Interaktive Diagramme und Grafiken',
      feature2: 'Kategorieaufschlüsselung und Fortschrittsbalken',
      feature3: 'Wöchentliche Nutzungsmetriken'
    }
  }
}
