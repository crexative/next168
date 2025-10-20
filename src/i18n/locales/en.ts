export default {
  app: {
    title: 'Next168',
    tagline: 'Master your next 168 hours.'
  },
  nav: {
    calendar: 'Calendar',
    categories: 'Categories',
    statistics: 'Statistics'
  },
  common: {
    add: 'Add',
    edit: 'Edit',
    delete: 'Delete',
    cancel: 'Cancel',
    save: 'Save',
    update: 'Update',
    close: 'Close',
    confirm: 'Confirm',
    hours: 'hours',
    hour: 'hour',
    minutes: 'minutes',
    blocks: 'blocks',
    active: 'active',
    today: 'Today',
    random: 'Random'
  },
  calendar: {
    title: 'Weekly Calendar',
    addBlock: 'Add Time Block',
    editBlock: 'Edit Time Block',
    noBlocks: 'No blocks scheduled',
    noBlocksDay: 'No blocks scheduled for this day',
    addFirstBlock: 'Add Your First Block',
    fields: {
      title: 'Title',
      titlePlaceholder: 'e.g., Team Meeting, Gym Session',
      description: 'Description (optional)',
      descriptionPlaceholder: 'Add any notes or details...',
      category: 'Category',
      categoryPlaceholder: 'Select a category',
      day: 'Day',
      startTime: 'Start Time',
      endTime: 'End Time',
      repeatDays: 'Repeat on Days',
      repeatDaysHint: 'Select multiple days for this time block'
    },
    days: {
      sunday: 'Sunday',
      monday: 'Monday',
      tuesday: 'Tuesday',
      wednesday: 'Wednesday',
      thursday: 'Thursday',
      friday: 'Friday',
      saturday: 'Saturday'
    },
    deleteConfirm: 'Are you sure you want to delete "{title}"?'
  },
  categories: {
    title: 'Categories',
    addCategory: 'Add Category',
    editCategory: 'Edit Category',
    noCategories: 'No categories yet',
    noCategoriesDesc: 'Add your first category to start tracking your time!',
    fields: {
      name: 'Name',
      namePlaceholder: 'e.g., Work, Exercise, Learning',
      nameRequired: 'Name *',
      icon: 'Icon',
      iconRequired: 'Icon *',
      color: 'Color',
      colorRequired: 'Color *',
      weeklyLimit: 'Weekly Hour Limit',
      weeklyLimitRequired: 'Weekly Hour Limit *',
      weeklyLimitHint: 'Maximum hours per week (0.5 - 168)'
    },
    stats: {
      weeklyLimit: 'Weekly Limit:',
      used: 'Used:',
      remaining: 'Remaining:',
      ofLimit: 'of limit'
    },
    selected: 'Selected',
    deleteConfirm: 'Are you sure you want to delete "{name}"? This action cannot be undone.'
  },
  statistics: {
    title: 'Statistics',
    scheduledHours: 'Scheduled Hours',
    availableHours: 'Available Hours',
    totalBlocks: 'Total Blocks',
    categoriesCount: 'Categories',
    categoryBreakdown: 'Category Breakdown',
    dailyDistribution: 'Daily Distribution',
    weekUtilization: 'Week Utilization',
    noCategories: 'No categories with scheduled time yet',
    utilizationText: 'You have scheduled <strong>{scheduled} hours</strong> out of <strong>{total} hours</strong> this week (<strong>{percentage}%</strong>).',
    availableText: 'There are still <strong>{available} hours</strong> available to plan.',
    scheduled: 'Scheduled',
    available: 'Available',
    chartLabel: 'Hours'
  },
  footer: {
    text: 'Next168 - Plan your next 168 hours, effortlessly'
  },
  errors: {
    categoryNotFound: 'Category not found',
    timeBlockNotFound: 'Time block not found',
    cannotDeleteCategory: 'Cannot delete category with {count} scheduled time blocks',
    cannotReduceLimit: 'Cannot reduce limit below current usage ({hours} hours scheduled)',
    invalidTime: 'Invalid time format',
    overlapDetected: 'Time block overlaps with existing block',
    categoryLimitExceeded: 'Adding this block would exceed category limit'
  },
  defaultCategories: {
    sleep: 'Sleep',
    work: 'Work',
    exercise: 'Exercise',
    learning: 'Learning',
    personalProjects: 'Personal Projects'
  },
  tutorial: {
    skip: 'Skip',
    next: 'Next',
    previous: 'Previous',
    getStarted: 'Get Started',
    step1: {
      title: 'Master Your 168 Hours',
      description: 'Every week has exactly 168 hours. Next168 helps you visualize and plan how to use them effectively.',
      feature1: 'See your entire week at a glance',
      feature2: 'Track time across all areas of your life',
      feature3: 'Never wonder where your time went'
    },
    step2: {
      title: 'Create Smart Categories',
      description: 'Organize your time with custom categories. Set weekly hour limits and track your progress.',
      feature1: 'Work, Exercise, Learning, Sleep, and more',
      feature2: 'Set realistic hour limits for each category',
      feature3: 'Beautiful icons and colors to stay organized'
    },
    step3: {
      title: 'Schedule Time Blocks',
      description: 'Add time blocks to your week and watch your schedule come to life. Repeat blocks across multiple days with one click.',
      feature1: 'Quick and easy time block creation',
      feature2: 'Repeat blocks on multiple days (Mon-Fri)',
      feature3: 'Automatic overlap detection'
    },
    step4: {
      title: 'Visualize Your Week',
      description: 'Get insights with beautiful charts and statistics. See how you\'re using your 168 hours.',
      feature1: 'Interactive charts and graphs',
      feature2: 'Category breakdown and progress bars',
      feature3: 'Weekly utilization metrics'
    }
  }
}
