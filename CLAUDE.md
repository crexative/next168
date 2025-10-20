# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Next168** is a smart weekly planner built with Vue 3, TypeScript, and Pinia. It helps users master their 168-hour week by creating categories with hour limits, scheduling time blocks, and visualizing usage through charts and statistics. The app features full internationalization (i18n) with 5 languages and follows WCAG 2.1 Level AA accessibility standards.

## Commands

### Development
```bash
npm run dev          # Start Vite dev server at http://localhost:5173
npm run build        # Type-check and build for production
npm run preview      # Preview production build locally
npm run type-check   # Run TypeScript type checking with vue-tsc
npm run lint         # Run ESLint with auto-fix
```

## Architecture

### Core State Management (Pinia Store)

The application uses a single Pinia store (`src/stores/weekStore.ts`) that manages all state:

**State:**
- `categories`: Array of Category objects (name, color, icon, weeklyHourLimit)
- `timeBlocks`: Array of TimeBlock objects (title, categoryId, dayOfWeek, startTime, endTime, durationMinutes)

**Key Computed Properties:**
- `categoryStats`: Calculates usage statistics for each category (totalHours, percentageOfLimit, remainingHours)
- `totalScheduledHours`: Sum of all time blocks in the week
- `unscheduledHours`: TOTAL_WEEK_HOURS (168) minus totalScheduledHours

**Critical Validation Logic:**
All mutations go through validation services before updating state:
- `ValidationService`: Validates time formats, overlaps, and data integrity
- Category limit checks: Prevents adding blocks that exceed weekly hour limits
- Overlap detection: Prevents time blocks from overlapping on the same day
- Deletion protection: Prevents deleting categories with active time blocks

### Data Flow Pattern

1. User action in component →
2. Component calls store action →
3. Store validates via ValidationService →
4. If valid: Update state + save to localStorage →
5. Reactive updates propagate to all components

### Responsive Design System

The app uses three breakpoints with distinct UI patterns:

**Desktop (>1024px):**
- 7-column calendar grid showing full week
- Modal dialogs for forms
- Header action buttons

**Tablet (769-1024px):**
- 3-column sliding calendar view
- Modal dialogs for forms
- Adaptive layouts

**Mobile (≤768px):**
- Single-day calendar view with navigation
- Bottom sheets instead of modals
- Floating Action Buttons (FABs)
- Swipe gestures for tab navigation
- Centered titles
- Touch feedback (scale on press)
- Safe area insets for notched devices

### Component Architecture

**App.vue** - Root component with tab navigation
- Manages active tab state ('calendar' | 'categories' | 'stats')
- Implements swipe gesture handling for mobile tab switching
- Renders three main views conditionally

**WeeklyCalendar.vue** - Time block management
- Desktop: Full 7-day grid
- Tablet: 3-day sliding view with center day navigation
- Mobile: Single day with prev/next buttons
- Uses BaseModal (desktop/tablet) and BaseBottomSheet (mobile)
- Integrates TimePicker component for time selection

**CategoryManager.vue** - Category CRUD
- Card-based category display with progress bars
- Smart emoji picker with auto-suggestions based on category name
- Color palette with random color generator
- FAB on mobile, header button on desktop/tablet

**StatsDashboard.vue** - Analytics visualization
- Summary cards (4 key metrics)
- Category breakdown with progress bars
- Chart.js stacked bar chart (daily distribution by category)
- Week utilization visualization

**LanguageSelector.vue** - i18n language switcher
- Dropdown with 5 language options (en, es, fr, pt, de)
- Uses Vue Teleport for proper z-index layering
- Auto-detects browser language on first visit
- Saves preference to localStorage

**Reusable UI Components:**
- `BaseModal.vue`: Desktop/tablet modal with Teleport, body scroll blocking, and symmetric enter/leave transitions
- `BaseBottomSheet.vue`: Mobile bottom sheet with Vue Transition for smooth slide-up/down animations
- `TimePicker.vue`: Native HTML time input wrapper with consistent styling
- `LanguageSelector.vue`: Multi-language selector with Teleport dropdown

### Time Handling

All times use 24-hour format ("HH:mm") internally:
- `startTime` and `endTime` stored as strings ("09:00", "17:30")
- `durationMinutes` calculated and stored for performance
- `calculateDurationMinutes()` in utils/timeCalculator.ts handles cross-midnight calculations
- Day.js used for date formatting and current day detection

### Data Persistence

Uses localStorage with the key `'next168-data'`:
- Auto-saves on every state mutation
- Loads on app mount
- Sample data initialized for new users
- No backend - fully client-side

Language preference stored in `'next168-language'`

### Validation Rules

**Time Blocks:**
- Start time must be before end time
- No overlapping blocks on the same day (checked in ValidationService)
- Must have valid category
- Duration must fit within category's remaining weekly limit

**Categories:**
- Name required (1-50 characters)
- Weekly hour limit: 0.5-168 hours
- Cannot delete category with active time blocks
- Cannot reduce limit below current usage

### Mobile-Specific Features

**Swipe Gestures:**
- Implemented in App.vue via touch event handlers
- Swipe left: Next tab (Calendar → Categories → Statistics)
- Swipe right: Previous tab
- 50px minimum swipe threshold
- Only works on mobile (≤768px)

**Native App Patterns:**
- Bottom tab bar with active indicator
- FAB buttons for primary actions
- Bottom sheets for forms
- Card-based layouts with touch feedback
- Safe area padding for notch/home indicator

### Chart.js Integration

StatsDashboard uses Chart.js for data visualization:
- Stacked bar chart shows category distribution across days
- Configured with `stacked: true` on both X and Y axes
- Dynamic datasets created from category data
- Custom tooltips show category name and hours
- Responsive with `maintainAspectRatio: false`

## Common Development Patterns

### Adding a New Time Validation Rule

1. Add validation logic to `src/services/ValidationService.ts`
2. Update the relevant store action (addTimeBlock/updateTimeBlock) to use new validation
3. Ensure error messages are user-friendly

### Adding a New Component

1. Create in `src/components/` (or `src/components/ui/` if reusable)
2. Use `<script setup lang="ts">` with TypeScript
3. For modals: Use BaseModal (desktop) and BaseBottomSheet (mobile) patterns
4. Add responsive styles with mobile-first approach
5. Test on all three breakpoints

### Modifying State Structure

1. Update TypeScript interfaces in `src/types/index.ts`
2. Update Pinia store in `src/stores/weekStore.ts`
3. Update validation in ValidationService if needed
4. Check StorageService for migration needs
5. Update all components that consume the changed state

## Key Files

- `src/stores/weekStore.ts` - Central state management
- `src/services/ValidationService.ts` - All validation logic
- `src/types/index.ts` - TypeScript type definitions and constants
- `src/App.vue` - Root component with tab navigation and swipe handling
- `src/utils/timeCalculator.ts` - Time calculation utilities

## Internationalization (i18n)

- **Framework**: vue-i18n v9 with Composition API mode
- **Supported Languages**: English, Spanish, French, Portuguese, German
- **Locale Files**: `src/i18n/locales/*.ts`
- **Auto-Detection**: Browser language detected on first visit
- **Persistence**: User preference saved in `localStorage` with key `next168-language`
- **Usage**: `const { t } = useI18n()` then `t('key.path')`

## Branding & Design System

**Next168 Brand Colors** (defined in `src/assets/base.css`):
```css
--next168-blue-deep: #1C2E4A;      /* Trust and focus */
--next168-green-neon: #30E6A5;     /* Energy and progress */
--next168-green-dark: #0D9B6E;     /* Accessible contrast version */
--next168-gray-light: #F4F5F7;     /* Clean balance */
--next168-black: #0D0D0D;          /* Visual strength */
```

**Semantic Color Variables**:
- `--color-primary`: Main accent color (green-neon)
- `--color-active-bg`: Active state background (green-dark for accessibility)
- `--color-active-text`: Active state text (#ffffff)
- `--color-hover-bg`: Hover state background (#e5e7eb)
- `--color-hover-text`: Hover state text (#1f2937)

**Accessibility**:
- WCAG 2.1 Level AA compliant
- Color contrast ratios >4.5:1 for all text
- ARIA labels on all interactive elements
- Keyboard navigation support

## TypeScript Notes

- Strict mode enabled
- All components use `<script setup lang="ts">`
- Store actions return `{ success: boolean; error?: string }` pattern
- Comprehensive type definitions in `src/types/index.ts`
