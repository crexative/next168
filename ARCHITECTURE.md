# Architecture Documentation

## Overview

Next168 follows clean architecture principles with a focus on:
- **SOLID principles** - Single Responsibility, Open/Closed, Liskov Substitution, Interface Segregation, Dependency Inversion
- **DRY (Don't Repeat Yourself)** - Reusable utilities and components
- **KISS (Keep It Simple, Stupid)** - Simple, readable code
- **YAGNI (You Aren't Gonna Need It)** - Build only what's needed now

## Architecture Layers

```
┌─────────────────────────────────────┐
│         Presentation Layer          │
│  (Vue Components, Composables)      │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│         Application Layer           │
│    (Pinia Store, Services)          │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│          Domain Layer               │
│  (Types, Interfaces, Validation)    │
└──────────────┬──────────────────────┘
               │
┌──────────────▼──────────────────────┐
│      Infrastructure Layer           │
│  (Repositories, Storage Adapters)   │
└─────────────────────────────────────┘
```

## Repository Pattern

The application uses the Repository Pattern to abstract data persistence. This makes it easy to switch between different storage backends (localStorage, Supabase, Firebase, etc.) without changing business logic.

### Key Components

#### 1. Interface (`IWeekDataRepository`)
```typescript
// src/repositories/IWeekDataRepository.ts
export interface IWeekDataRepository {
  save(data: WeekData): Promise<boolean>
  load(): Promise<WeekData | null>
  clear(): Promise<boolean>
  exists(): Promise<boolean>
}
```

#### 2. Implementations
- **LocalStorageRepository** - Current implementation using browser localStorage
- **SupabaseRepository.example.ts** - Example template for Supabase backend
- Future: Firebase, IndexedDB, REST API, etc.

#### 3. Factory (`repositoryFactory.ts`)
Creates the appropriate repository based on configuration:

```typescript
const REPOSITORY_TYPE = 'localStorage' // Can be changed to 'supabase', 'firebase', etc.
export const weekDataRepository = createWeekDataRepository()
```

### How to Switch Storage Backends

#### Option 1: Switch to Supabase

1. **Install dependencies:**
   ```bash
   npm install @supabase/supabase-js
   ```

2. **Rename example file:**
   ```bash
   mv src/repositories/SupabaseRepository.example.ts src/repositories/SupabaseRepository.ts
   ```

3. **Uncomment implementation code** in `SupabaseRepository.ts`

4. **Update factory:**
   ```typescript
   // src/repositories/repositoryFactory.ts
   const REPOSITORY_TYPE = 'supabase'
   ```

5. **Add environment variables:**
   ```env
   VITE_SUPABASE_URL=your-project-url
   VITE_SUPABASE_KEY=your-anon-key
   ```

6. **Create Supabase table:**
   ```sql
   CREATE TABLE week_data (
     id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
     user_id TEXT NOT NULL,
     categories JSONB NOT NULL,
     time_blocks JSONB NOT NULL,
     created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
     UNIQUE(user_id)
   );
   ```

#### Option 2: Create Custom Implementation

1. **Create new repository class:**
   ```typescript
   // src/repositories/YourRepository.ts
   import type { IWeekDataRepository } from './IWeekDataRepository'

   export class YourRepository implements IWeekDataRepository {
     async save(data: WeekData): Promise<boolean> {
       // Your implementation
     }
     // ... implement other methods
   }
   ```

2. **Register in factory:**
   ```typescript
   // src/repositories/repositoryFactory.ts
   case 'your-backend':
     return new YourRepository(/* config */)
   ```

## Validation Service

The `ValidationService` handles all business logic validation:
- Time block validation (overlaps, duration limits)
- Category validation (limits, usage)
- Unique day counting (prevents duplicate day counting in repeat blocks)

### Key Methods

```typescript
validateTimeBlock(timeBlock, existingBlocks): ValidationResult
validateCategory(category): ValidationResult
canAddTimeToCategory(categoryId, duration, ...): ValidationResult
```

## Store Architecture

The Pinia store (`weekStore.ts`) acts as the application layer:
- Manages state (categories, timeBlocks)
- Computes derived data (categoryStats, totalScheduledHours)
- Validates operations through ValidationService
- Persists data through Repository Pattern

### Key Computed Properties

```typescript
categoryStats      // Usage statistics for each category
totalScheduledHours // Total hours scheduled across all blocks
unscheduledHours   // Remaining hours in the week
```

## Utilities

### timeBlockUtils.ts
```typescript
countUniqueDays(dayOfWeek, repeatDays) // Counts unique days handling duplicates
countBlockUniqueDays(block)            // Convenience wrapper for TimeBlock
```

### timeCalculator.ts
```typescript
calculateDurationMinutes(startTime, endTime) // Handles cross-midnight calculations
minutesToHours(minutes)                      // Converts minutes to hours
```

## Testing

The project uses Vitest for unit testing:

```bash
npm test           # Run tests once
npm test -- --ui   # Run tests with UI
npm run type-check # TypeScript type checking
```

### Test Coverage

- ✅ ValidationService (category limits, unique day counting)
- ✅ Type checking (all TypeScript interfaces)
- 🔄 Component tests (future)
- 🔄 E2E tests (future)

## Benefits of This Architecture

1. **Separation of Concerns** - Each layer has a specific responsibility
2. **Testability** - Services can be tested independently
3. **Maintainability** - Easy to understand and modify
4. **Scalability** - Easy to add new features or backends
5. **Type Safety** - Full TypeScript coverage with interfaces
6. **Flexibility** - Swap implementations without changing business logic

## Design Patterns Used

- **Repository Pattern** - Data access abstraction
- **Factory Pattern** - Repository creation
- **Service Layer** - Business logic separation
- **Dependency Injection** - Loosely coupled components
- **Computed Properties** - Reactive derived state

## Future Improvements

- [ ] Add caching layer for computed data
- [ ] Implement offline-first sync with service workers
- [ ] Add migration system for schema changes
- [ ] Implement undo/redo functionality
- [ ] Add data export/import features
- [ ] Create repository adapters for multiple backends
