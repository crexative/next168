# Universal Master Prompt - Professional Application Development

> **A technology-agnostic framework for AI-assisted development of any software project**

This document provides a complete, framework-independent workflow for creating production-ready applications using AI assistance. Whether you're building web, mobile, desktop, CLI, or backend applications in any programming language or framework, this guide ensures professional standards and best practices.

---

## 📋 Table of Contents

1. [Universal Project Initialization](#1-universal-project-initialization)
2. [Architecture & Planning (Framework Agnostic)](#2-architecture--planning-framework-agnostic)
3. [Development Workflow](#3-development-workflow)
4. [Internationalization (Any Platform)](#4-internationalization-any-platform)
5. [Accessibility & User Experience](#5-accessibility--user-experience)
6. [Quality Assurance](#6-quality-assurance)
7. [Documentation Standards](#7-documentation-standards)
8. [Production Readiness](#8-production-readiness)
9. [Universal Patterns Library](#9-universal-patterns-library)

---

## 1. Universal Project Initialization

### Technology-Agnostic Initial Prompt

```markdown
I need you to create a software application with the following requirements:

═══════════════════════════════════════════════════════════════
PROJECT DEFINITION
═══════════════════════════════════════════════════════════════

NAME: [Project Name]

TYPE: [Select one or multiple]
□ Web Application (Frontend)
□ API/Backend Service
□ Mobile Application (iOS/Android)
□ Desktop Application
□ Command Line Tool
□ Library/Package
□ Full-Stack Application
□ Microservice
□ Other: ___________

DESCRIPTION:
[2-3 sentences describing what the application does]

TARGET USERS:
[Who will use this application]

═══════════════════════════════════════════════════════════════
CORE FEATURES (List 3-7 main features)
═══════════════════════════════════════════════════════════════

1. [Feature 1]
2. [Feature 2]
3. [Feature 3]
4. [Feature 4]
5. [Feature 5]

═══════════════════════════════════════════════════════════════
TECHNICAL PREFERENCES (Optional - AI can recommend)
═══════════════════════════════════════════════════════════════

PROGRAMMING LANGUAGE: [e.g., JavaScript, Python, Go, Java, Swift, or "recommend"]

PREFERRED FRAMEWORKS/LIBRARIES: [e.g., React, Django, Flutter, or "recommend based on requirements"]

DATABASE (if needed): [e.g., PostgreSQL, MongoDB, SQLite, or "recommend"]

HOSTING/DEPLOYMENT: [e.g., Vercel, AWS, Docker, or "recommend"]

═══════════════════════════════════════════════════════════════
REQUIREMENTS & CONSTRAINTS
═══════════════════════════════════════════════════════════════

SCALE:
□ Small (< 1K users)
□ Medium (1K - 100K users)
□ Large (> 100K users)

PLATFORM SUPPORT:
□ Web (Desktop browsers)
□ Web (Mobile browsers)
□ iOS Native
□ Android Native
□ Windows Desktop
□ macOS Desktop
□ Linux
□ Cross-platform

MUST-HAVE FEATURES:
☑ Type safety (TypeScript, type hints, etc.)
☑ Error handling
☑ Input validation
☑ Security best practices
☑ Performance optimization
☑ Documentation
☑ Production-ready code
☐ Internationalization (i18n)
☐ Accessibility (WCAG compliance)
☐ Offline support
☐ Real-time features
☐ Authentication/Authorization
☐ Payment processing
☐ Analytics/Monitoring
☐ Other: ___________

TIMELINE: [Expected development time]

═══════════════════════════════════════════════════════════════
DESIGN & USER EXPERIENCE
═══════════════════════════════════════════════════════════════

DESIGN STYLE: [Modern/Minimal/Corporate/Playful/etc. or "recommend"]

BRAND COLORS: [If known, or "recommend color palette"]

RESPONSIVE DESIGN: [Yes/No - specify devices if applicable]

ACCESSIBILITY LEVEL: [WCAG 2.1 Level A/AA/AAA or "N/A"]

═══════════════════════════════════════════════════════════════
ADDITIONAL CONTEXT
═══════════════════════════════════════════════════════════════

[Any additional information, constraints, or specific requirements]

═══════════════════════════════════════════════════════════════

Please analyze these requirements and:
1. Recommend the optimal tech stack if not specified
2. Create a detailed project architecture
3. Generate a complete development plan with milestones
4. Start with project initialization and setup

Use best practices for the chosen technology stack.
```

### Follow-Up Development Workflow Prompt

```markdown
After receiving the initial setup, follow this universal workflow:

PHASE 1: PLANNING & ARCHITECTURE (10% of time)
═══════════════════════════════════════════════════
1. Create comprehensive TODO list (use TodoWrite tool)
2. Define project structure (folders/modules/packages)
3. Design data models and types
4. Plan component/module hierarchy
5. Identify reusable patterns
6. Define API contracts (if applicable)
7. Document architecture decisions

PHASE 2: FOUNDATION (20% of time)
═══════════════════════════════════════════════════
1. Initialize project with build tools
2. Setup development environment
3. Configure linting and formatting
4. Implement core utilities
5. Setup routing/navigation (if applicable)
6. Configure state management (if applicable)
7. Setup testing framework
8. Create project documentation structure

PHASE 3: CORE DEVELOPMENT (50% of time)
═══════════════════════════════════════════════════
1. Implement features incrementally (one at a time)
2. Write tests for each feature
3. Handle edge cases and errors
4. Mark TODOs as complete
5. Refactor as patterns emerge
6. Code review and optimization
7. Integration testing

PHASE 4: POLISH & UX (15% of time)
═══════════════════════════════════════════════════
1. Enhance user experience
2. Add loading states
3. Implement error boundaries
4. Add animations/transitions (if UI)
5. Optimize performance
6. Accessibility audit and fixes
7. Cross-platform testing
8. Edge case handling

PHASE 5: PRODUCTION PREPARATION (5% of time)
═══════════════════════════════════════════════════
1. Complete all documentation
2. Security audit
3. Performance testing
4. Build optimization
5. Deployment configuration
6. Monitoring setup
7. Final QA checklist
8. Create deployment guide

For each phase, update the TODO list and mark items complete.
```

---

## 2. Architecture & Planning (Framework Agnostic)

### Universal Project Structure Prompt

```markdown
Design a professional project structure for this application:

REQUIREMENTS:
═══════════════════════════════════════════════════
□ Follows industry best practices for [language/framework]
□ Clear separation of concerns
□ Scalable and maintainable
□ Easy to navigate for new developers
□ Supports testing
□ Handles configuration properly

ARCHITECTURE PRINCIPLES:
═══════════════════════════════════════════════════
✓ Single Responsibility Principle
✓ Don't Repeat Yourself (DRY)
✓ Keep It Simple (KISS)
✓ Separation of Concerns
✓ Dependency Injection where applicable
✓ Configuration separate from code

CREATE:
═══════════════════════════════════════════════════
1. Complete folder/package structure
2. Explanation of each directory's purpose
3. Naming conventions to follow
4. Configuration file locations
5. Example of where different file types go
6. README.md outline

Consider the project type and recommend structure accordingly:
- If UI application: separate presentation from logic
- If API: separate routes, controllers, services, data access
- If CLI: separate commands, utilities, configuration
- If library: separate public API from internal implementation
```

### Data Modeling Prompt (Language Agnostic)

```markdown
Design the data architecture for this application:

DATA REQUIREMENTS:
═══════════════════════════════════════════════════

ENTITIES: [List main data entities]
- Entity 1: [description]
- Entity 2: [description]
- Entity 3: [description]

RELATIONSHIPS:
- [Entity A] → [Entity B]: [type of relationship]

CREATE FOR CHOSEN LANGUAGE/FRAMEWORK:
═══════════════════════════════════════════════════

1. DATA TYPES/SCHEMAS:
   - Type definitions (TypeScript interfaces, Python dataclasses,
     Go structs, Java classes, etc.)
   - Validation rules
   - Default values
   - Constraints

2. RELATIONSHIPS:
   - How entities relate
   - Foreign keys (if SQL)
   - References (if NoSQL)
   - Embedded vs referenced data

3. VALIDATION RULES:
   - Required fields
   - Format validations
   - Business logic constraints
   - Custom validators

4. SAMPLE DATA:
   - Representative examples
   - Edge cases
   - Seed data for development

5. PERSISTENCE STRATEGY:
   - Database schema (if applicable)
   - File format (if file-based)
   - Caching strategy
   - Migration approach
```

---

## 3. Development Workflow

### Universal Component/Module Development Prompt

```markdown
Create a [Component/Module/Class/Function] named [Name]:

FUNCTIONALITY:
═══════════════════════════════════════════════════
[Describe what it should do]

INPUTS/PARAMETERS:
═══════════════════════════════════════════════════
- Parameter 1: [type] - [description]
- Parameter 2: [type] - [description]

OUTPUTS/RETURNS:
═══════════════════════════════════════════════════
[Describe return value(s)]

STATE/DATA MANAGEMENT:
═══════════════════════════════════════════════════
- What data does it need to track?
- Is state local or shared?
- Persistence requirements?

ERROR HANDLING:
═══════════════════════════════════════════════════
- What can go wrong?
- How should errors be handled?
- What error types to throw/return?

EDGE CASES:
═══════════════════════════════════════════════════
- Empty input
- Invalid input
- Null/undefined/None values
- Large datasets
- Concurrent access (if applicable)

CODE QUALITY REQUIREMENTS:
═══════════════════════════════════════════════════
☑ Type-safe (use appropriate type system)
☑ Well-documented (comments/docstrings)
☑ Single responsibility
☑ Reusable and modular
☑ Testable design
☑ Performance optimized
☑ Security considered
☑ Follows language/framework conventions

INCLUDE:
═══════════════════════════════════════════════════
1. Implementation code
2. Documentation (JSDoc/docstrings/etc.)
3. Usage examples
4. Test cases (unit tests)
5. Error handling examples
```

### Universal API Endpoint Development (Backend)

```markdown
Create an API endpoint for [Resource/Action]:

ENDPOINT SPECIFICATION:
═══════════════════════════════════════════════════
METHOD: [GET/POST/PUT/PATCH/DELETE]
PATH: /api/[resource]/[action]
PURPOSE: [What this endpoint does]

REQUEST:
═══════════════════════════════════════════════════
Headers:
- Authorization: [if required]
- Content-Type: [application/json, etc.]

Parameters:
- [param1]: [type] - [description]
- [param2]: [type] - [description]

Body (if POST/PUT/PATCH):
```json
{
  "field1": "value",
  "field2": "value"
}
```

RESPONSE FORMAT:
═══════════════════════════════════════════════════

Success (2xx):
```json
{
  "status": "success",
  "data": { /* response data */ }
}
```

Error (4xx/5xx):
```json
{
  "status": "error",
  "message": "Error description",
  "code": "ERROR_CODE"
}
```

REQUIREMENTS:
═══════════════════════════════════════════════════
☑ Input validation (all fields)
☑ Authentication check (if required)
☑ Authorization check (if required)
☑ Error handling (try/catch, error middleware)
☑ Logging (request/response/errors)
☑ Rate limiting (if applicable)
☑ Data sanitization
☑ Response formatting
☑ HTTP status codes (correct usage)

SECURITY:
═══════════════════════════════════════════════════
- SQL injection prevention
- XSS prevention
- CSRF protection (if applicable)
- Input validation
- Output encoding

INCLUDE:
═══════════════════════════════════════════════════
1. Route handler/controller
2. Validation logic
3. Business logic/service layer
4. Error handling
5. Documentation (OpenAPI/Swagger or comments)
6. Example requests/responses
7. Integration tests
```

### Universal State Management Prompt

```markdown
Setup state/data management for this application:

REQUIREMENTS:
═══════════════════════════════════════════════════

GLOBAL STATE NEEDS:
- [Data type 1]: [Why it needs to be global]
- [Data type 2]: [Why it needs to be global]

LOCAL STATE NEEDS:
- [Data type 1]: [Component/module specific]
- [Data type 2]: [Component/module specific]

PERSISTENCE:
□ Memory only (session)
□ Local storage/preferences
□ Database
□ File system
□ Remote server

CHOOSE APPROPRIATE PATTERN FOR TECH STACK:
═══════════════════════════════════════════════════

For Web (Frontend):
- Redux, Zustand, MobX, Pinia, Context API, etc.

For Mobile:
- Redux, MobX, Provider, Riverpod, BLoC, etc.

For Backend:
- Singleton pattern, Service layer, Repository pattern

For Desktop:
- Application state management pattern for framework

IMPLEMENT:
═══════════════════════════════════════════════════
1. State structure/schema
2. Actions/mutations for state changes
3. Selectors/getters for reading state
4. Type definitions for state
5. Persistence logic (if needed)
6. State initialization
7. Usage examples
8. Testing approach
```

---

## 4. Internationalization (Any Platform)

### Universal i18n Setup Prompt

```markdown
Implement internationalization (i18n) for this application:

SUPPORTED LANGUAGES:
═══════════════════════════════════════════════════
1. [Language 1 - e.g., English] (default)
2. [Language 2 - e.g., Spanish]
3. [Language 3 - e.g., French]
[Add more as needed]

FEATURES REQUIRED:
═══════════════════════════════════════════════════
☑ Detect user's language preference
☑ Allow manual language selection
☑ Persist language choice
☑ Fallback to default language
☑ Support for all UI text
☐ Pluralization rules (if needed)
☐ Date/time formatting
☐ Number formatting
☐ Currency formatting
☐ RTL language support (Arabic, Hebrew)

CHOOSE APPROPRIATE i18n LIBRARY FOR TECH STACK:
═══════════════════════════════════════════════════

Web Frontend:
- i18next, react-intl, vue-i18n, formatjs, etc.

Mobile:
- i18next, react-native-localize, Flutter intl, etc.

Backend:
- i18next, gettext, fluent, etc.

Desktop:
- Qt Linguist, NSLocalizedString, etc.

IMPLEMENTATION STRUCTURE:
═══════════════════════════════════════════════════

/locales (or /translations, /i18n)
  ├── en.[format]      # English (default)
  ├── es.[format]      # Spanish
  ├── fr.[format]      # French
  └── [lang].[format]  # Other languages

Each locale file should contain:
═══════════════════════════════════════════════════
```json
{
  "app": {
    "title": "Application Name",
    "tagline": "Application tagline",
    "description": "Full description"
  },
  "navigation": {
    "home": "Home",
    "settings": "Settings"
  },
  "common": {
    "save": "Save",
    "cancel": "Cancel",
    "delete": "Delete",
    "confirm": "Confirm"
  },
  "messages": {
    "success": "Operation successful",
    "error": "An error occurred"
  },
  "errors": {
    "network": "Network error occurred",
    "validation": "Please check your input"
  }
}
```

SETUP TASKS:
═══════════════════════════════════════════════════
1. Install and configure i18n library
2. Create locale files structure
3. Implement language detection
4. Create language selector UI (if applicable)
5. Setup persistence mechanism
6. Replace all hardcoded strings
7. Add type safety for translation keys
8. Document translation process
9. Create translation guide for contributors

USAGE PATTERN:
═══════════════════════════════════════════════════
Show examples of how to use translations in code:
- Simple string: t('common.save')
- With variables: t('messages.welcome', { name: userName })
- Pluralization: t('items', { count: itemCount })
```

### Universal Translation Prompt

```markdown
Translate application strings to [Target Language]:

SOURCE LANGUAGE: [e.g., English]
TARGET LANGUAGE: [e.g., Spanish / German / Japanese]

CONTEXT:
═══════════════════════════════════════════════════
PRODUCT TYPE: [e.g., E-commerce, SaaS, Mobile Game]
INDUSTRY: [e.g., Healthcare, Finance, Education]
TARGET AUDIENCE: [e.g., Business professionals, Students, General public]
TONE: [e.g., Professional, Casual, Friendly, Technical]

TRANSLATION GUIDELINES:
═══════════════════════════════════════════════════
✓ Maintain professional/casual tone as appropriate
✓ Keep brand names untranslated
✓ Preserve placeholders: {variable}, %s, $1, etc.
✓ Maintain HTML/markup tags if present
✓ Use natural, native-sounding language
✓ Consider cultural context
✓ Keep technical terms accurate
✓ Maintain text length similar to original (UI space)
✓ Use formal/informal address as culturally appropriate

SPECIAL REQUIREMENTS:
═══════════════════════════════════════════════════
□ Gender-neutral language (if applicable)
□ Regional variant: [e.g., Spanish (Spain) vs Spanish (Latin America)]
□ Industry-specific terminology
□ Legal/compliance language accuracy
□ Accessibility text (screen reader descriptions)

DELIVER:
═══════════════════════════════════════════════════
1. Complete translated locale file
2. Same structure as source language
3. Notes on any translation decisions
4. Flags for terms needing review by native speaker
```

---

## 5. Accessibility & User Experience

### Universal Accessibility Audit Prompt

```markdown
Perform accessibility audit for WCAG 2.1 Level [A/AA/AAA]:

SCOPE:
═══════════════════════════════════════════════════
Application Type: [Web/Mobile/Desktop]
Platform: [Specific platform details]
Assistive Technologies to Support: [Screen readers, keyboards, etc.]

AUDIT AREAS:
═══════════════════════════════════════════════════

1. PERCEIVABLE
───────────────────────────────────────────────────
☐ Color Contrast:
  - Text contrast ratios ≥ 4.5:1 (AA) or ≥ 7:1 (AAA)
  - UI component contrast ≥ 3:1
  - Focus indicators visible

☐ Alternative Text:
  - All images have alt text
  - Decorative images marked as such
  - Complex images have detailed descriptions

☐ Multimedia:
  - Captions for video
  - Transcripts for audio
  - Audio descriptions (if AAA)

☐ Adaptable:
  - Content structure is logical
  - Reading order makes sense
  - No information lost when linearized

2. OPERABLE
───────────────────────────────────────────────────
☐ Keyboard Access:
  - All functionality available via keyboard
  - Logical tab order
  - No keyboard traps
  - Skip navigation links

☐ Timing:
  - No time limits, or adjustable
  - Can pause, stop animations
  - No flashing content (seizure risk)

☐ Navigation:
  - Clear page titles
  - Descriptive headings
  - Breadcrumbs (if applicable)
  - Consistent navigation

☐ Input Modalities:
  - Touch targets ≥ 44x44 CSS pixels (mobile)
  - Gestures have alternatives
  - Motion/orientation changes optional

3. UNDERSTANDABLE
───────────────────────────────────────────────────
☐ Readable:
  - Language declared
  - Readable text (not images of text)
  - Clear error messages

☐ Predictable:
  - Consistent navigation
  - Consistent identification
  - No unexpected context changes

☐ Input Assistance:
  - Form labels associated
  - Error identification
  - Error suggestions
  - Prevent errors (confirmation)

4. ROBUST
───────────────────────────────────────────────────
☐ Compatible:
  - Valid HTML/markup
  - ARIA used correctly
  - Name, role, value for all components
  - Status messages announced

PLATFORM-SPECIFIC CHECKS:
═══════════════════════════════════════════════════

For Web:
- Semantic HTML elements
- ARIA labels where needed
- Landmark regions
- Form validation

For Mobile:
- System accessibility features work
- VoiceOver/TalkBack support
- Dynamic type support
- Reduce motion support

For Desktop:
- System high contrast mode
- Screen reader compatibility
- Keyboard shortcuts documented

PROVIDE:
═══════════════════════════════════════════════════
1. Issues found (grouped by severity: Critical/High/Medium/Low)
2. Specific location of each issue
3. How to fix (code examples)
4. Priority order for fixes
5. Testing methodology used
6. Tools/resources for ongoing compliance
```

### Universal UX Enhancement Prompt

```markdown
Enhance user experience for [Feature/Screen/Flow]:

CURRENT STATE ANALYSIS:
═══════════════════════════════════════════════════
User Flow: [Describe current user journey]
Pain Points: [List issues users face]
Friction Points: [Where users get stuck]
Cognitive Load: [Is it overwhelming?]

IMPROVEMENTS NEEDED:
═══════════════════════════════════════════════════

1. FEEDBACK & COMMUNICATION
───────────────────────────────────────────────────
☐ Loading States:
  - Spinners/progress bars for operations
  - Skeleton screens for content loading
  - Percentage progress for long operations
  - Optimistic updates where appropriate

☐ Success Feedback:
  - Confirmation messages
  - Visual indicators (checkmarks, highlights)
  - Success animations
  - Toast/snackbar notifications

☐ Error Handling:
  - Clear, actionable error messages
  - Inline validation (forms)
  - Error recovery suggestions
  - Prevent errors when possible
  - Graceful degradation

2. VISUAL HIERARCHY
───────────────────────────────────────────────────
☐ Typography scale clear
☐ Primary actions stand out
☐ Important information prominent
☐ Whitespace used effectively
☐ Visual grouping of related items

3. INTERACTION PATTERNS
───────────────────────────────────────────────────
☐ Micro-interactions:
  - Hover effects
  - Click/tap feedback
  - Smooth transitions
  - State changes animated

☐ Gestures (if applicable):
  - Swipe actions
  - Pull to refresh
  - Pinch to zoom
  - Long press menus

4. EMPTY & ERROR STATES
───────────────────────────────────────────────────
☐ First-time user experience (onboarding)
☐ No data scenarios (helpful empty states)
☐ No results found (suggestions)
☐ Offline state (what's available)
☐ Error states (recovery path)

5. PERFORMANCE PERCEPTION
───────────────────────────────────────────────────
☐ Instant feedback on actions
☐ Perceived performance (loading strategies)
☐ Smooth animations (60fps)
☐ Lazy loading non-critical content
☐ Prefetching likely next actions

6. PLATFORM-SPECIFIC UX
───────────────────────────────────────────────────

Mobile:
- Bottom navigation for thumb reach
- Sheet modals instead of dialogs
- Swipe gestures
- Large touch targets
- Safe area consideration

Desktop:
- Keyboard shortcuts
- Right-click context menus
- Drag and drop
- Hover interactions
- Multi-window support

DELIVER:
═══════════════════════════════════════════════════
1. Updated implementation with enhancements
2. Animation/transition specifications
3. New user flow diagram
4. Before/after comparison
5. Metrics to measure improvement
```

---

## 6. Quality Assurance

### Universal Testing Strategy Prompt

```markdown
Create comprehensive testing strategy for this application:

PROJECT TYPE: [Web/Mobile/Backend/Desktop/CLI]
TECH STACK: [Language, Framework, Platform]

TESTING PYRAMID:
═══════════════════════════════════════════════════

UNIT TESTS (70%)
───────────────────────────────────────────────────
Focus: Individual functions, methods, classes
Coverage: Business logic, utilities, algorithms

What to test:
☐ Pure functions
☐ Business logic
☐ Utility functions
☐ Data transformations
☐ Validation rules
☐ Edge cases
☐ Error conditions

Framework recommendations for [tech stack]
Example tests for critical functions

INTEGRATION TESTS (20%)
───────────────────────────────────────────────────
Focus: Component interactions, API calls, database

What to test:
☐ API endpoints (Backend)
☐ Database operations
☐ Component integration (Frontend)
☐ Service layer interactions
☐ Third-party integrations
☐ Authentication flows
☐ Data persistence

Framework recommendations for [tech stack]
Example integration test setup

END-TO-END TESTS (10%)
───────────────────────────────────────────────────
Focus: Complete user workflows, critical paths

What to test:
☐ User registration/login
☐ Core feature workflows
☐ Payment processing
☐ Data submission flows
☐ Cross-browser (if web)
☐ Cross-device (if mobile)

Framework recommendations:
- Web: Cypress, Playwright, Selenium
- Mobile: Appium, Detox, XCUITest
- API: Postman, REST-assured

SPECIALIZED TESTING:
═══════════════════════════════════════════════════

☐ Performance Testing:
  - Load testing (many users)
  - Stress testing (breaking point)
  - Spike testing (sudden traffic)
  - Endurance testing (long period)

☐ Security Testing:
  - Penetration testing
  - Vulnerability scanning
  - Authentication/authorization
  - Data encryption
  - Input validation

☐ Accessibility Testing:
  - Automated: axe, WAVE, Lighthouse
  - Manual: Screen reader testing
  - Keyboard navigation
  - Color contrast

☐ Usability Testing:
  - User feedback sessions
  - A/B testing
  - Analytics review

TEST COVERAGE GOALS:
═══════════════════════════════════════════════════
- Overall: > 80%
- Critical paths: 100%
- Business logic: > 90%
- UI components: > 70%

SETUP DELIVERABLES:
═══════════════════════════════════════════════════
1. Testing framework installation
2. Test configuration files
3. Test utilities and helpers
4. Mock data generators
5. Example tests for each type
6. CI/CD integration
7. Coverage reporting
8. Testing documentation
```

### Universal Code Quality Review Prompt

```markdown
Perform comprehensive code quality review:

AUTOMATED CHECKS:
═══════════════════════════════════════════════════

☐ Linting:
  - Tool: [ESLint, pylint, golangci-lint, etc.]
  - Rules: [Standard, Airbnb, Google Style Guide, etc.]
  - Fix auto-fixable issues

☐ Type Checking:
  - TypeScript, mypy, Flow, type hints, etc.
  - No 'any' types (or minimal)
  - Proper type definitions

☐ Formatting:
  - Tool: [Prettier, Black, gofmt, etc.]
  - Consistent code style
  - Auto-format on save

☐ Security Scanning:
  - Dependency vulnerabilities
  - Code vulnerabilities
  - Secrets detection
  - OWASP Top 10 check

MANUAL CODE REVIEW:
═══════════════════════════════════════════════════

1. CODE STRUCTURE
───────────────────────────────────────────────────
☐ Single Responsibility Principle
☐ DRY (Don't Repeat Yourself)
☐ KISS (Keep It Simple)
☐ Clear function/method names
☐ Appropriate file organization
☐ Separation of concerns

2. COMPLEXITY
───────────────────────────────────────────────────
☐ Cyclomatic complexity (< 10 per function)
☐ Function length (< 50 lines ideally)
☐ Nesting depth (< 4 levels)
☐ Parameter count (< 5 parameters)
☐ Complex logic documented

3. ERROR HANDLING
───────────────────────────────────────────────────
☐ Try/catch or error returns everywhere needed
☐ Meaningful error messages
☐ Proper error propagation
☐ No silent failures
☐ Logging appropriate errors

4. PERFORMANCE
───────────────────────────────────────────────────
☐ No N+1 queries
☐ Appropriate caching
☐ Lazy loading where applicable
☐ Avoid premature optimization
☐ No memory leaks
☐ Efficient algorithms

5. SECURITY
───────────────────────────────────────────────────
☐ Input validation
☐ Output encoding
☐ No hardcoded secrets
☐ Secure dependencies
☐ Proper authentication
☐ Authorization checks
☐ HTTPS/encryption where needed

6. MAINTAINABILITY
───────────────────────────────────────────────────
☐ Clear variable names
☐ Comments explain "why" not "what"
☐ No commented-out code
☐ No TODO comments (or tracked)
☐ Magic numbers extracted to constants
☐ Consistent patterns throughout

7. TESTABILITY
───────────────────────────────────────────────────
☐ Pure functions where possible
☐ Dependency injection
☐ Mockable dependencies
☐ Test coverage adequate

PROVIDE REPORT:
═══════════════════════════════════════════════════
1. Issues found (by severity: Critical/High/Medium/Low)
2. Code snippets showing issues
3. Suggested refactorings
4. Performance improvements
5. Security fixes
6. Overall quality score
7. Actionable next steps
```

---

## 7. Documentation Standards

### Universal Documentation Prompt

```markdown
Create comprehensive project documentation:

REQUIRED DOCUMENTATION:
═══════════════════════════════════════════════════

1. README.md (Main Project Documentation)
═══════════════════════════════════════════════════

Include:
───────────────────────────────────────────────────
# [Project Name]

> [One-line description]

[Brief paragraph about what this project does and why it exists]

## Features
- Feature 1
- Feature 2
- Feature 3

## Tech Stack
- [Technology 1]: [Version]
- [Technology 2]: [Version]
- [Technology 3]: [Version]

## Prerequisites
- [Requirement 1]: [Version]
- [Requirement 2]: [Version]

## Installation
```bash
# Step-by-step installation commands
```

## Usage
```[language]
# Code examples showing how to use
```

## Configuration
[Environment variables, config files, settings]

## API Documentation (if applicable)
[Link to API docs or brief overview]

## Development
```bash
# How to setup development environment
# How to run locally
# How to run tests
```

## Deployment
[How to deploy to production]

## Contributing
[How others can contribute]

## License
[License type]

## Support
[How to get help]

2. ARCHITECTURE.md (Technical Documentation)
═══════════════════════════════════════════════════

Include:
───────────────────────────────────────────────────
# Architecture

## Overview
[High-level architecture description]

## Folder Structure
```
[Detailed folder structure with explanations]
```

## Design Patterns
[Patterns used and why]

## Data Flow
[How data moves through the system]

## State Management
[How application state is managed]

## Key Technical Decisions
[Important decisions and trade-offs]

## Diagrams
[Architecture diagrams, flow charts, sequence diagrams]

3. API_DOCUMENTATION.md (if Backend/API)
═══════════════════════════════════════════════════

For each endpoint:
───────────────────────────────────────────────────
### [METHOD] /api/endpoint

**Description**: What this endpoint does

**Authentication**: Required/Optional

**Parameters**:
- `param1` (type): Description
- `param2` (type): Description

**Request Body**:
```json
{
  "field": "example"
}
```

**Response**:
```json
{
  "status": "success",
  "data": {}
}
```

**Status Codes**:
- 200: Success
- 400: Bad Request
- 401: Unauthorized
- 404: Not Found
- 500: Server Error

**Example**:
```bash
curl -X POST /api/endpoint \
  -H "Authorization: Bearer token" \
  -d '{"field": "value"}'
```

4. DEPLOYMENT.md
═══════════════════════════════════════════════════

Include:
───────────────────────────────────────────────────
# Deployment Guide

## Platforms
[Supported deployment platforms]

## Environment Variables
```
VAR_NAME=description
```

## Build Process
```bash
# Build commands
```

## Deployment Steps
[Step-by-step for each platform]

## CI/CD
[Continuous integration/deployment setup]

## Monitoring
[How to monitor application]

## Troubleshooting
[Common issues and solutions]

5. CONTRIBUTING.md
═══════════════════════════════════════════════════

Include:
───────────────────────────────────────────────────
# Contributing Guidelines

## Code Style
[Style guide to follow]

## Git Workflow
[Branching strategy, commit messages]

## Pull Request Process
[How to submit PRs]

## Testing Requirements
[Testing expectations]

## Code Review Process
[How code is reviewed]

INLINE CODE DOCUMENTATION:
═══════════════════════════════════════════════════

Use appropriate documentation format:
- JavaScript/TypeScript: JSDoc
- Python: Docstrings
- Java: Javadoc
- Go: Godoc comments
- etc.

Example format:
───────────────────────────────────────────────────
```
/**
 * [Brief description of function]
 *
 * [Detailed description if needed]
 *
 * @param {Type} paramName - Description
 * @param {Type} paramName - Description
 * @returns {Type} Description of return value
 * @throws {ErrorType} When this error occurs
 * @example
 * functionName(arg1, arg2)
 * // => expected output
 */
```

DOCUMENTATION PRINCIPLES:
═══════════════════════════════════════════════════
✓ Keep it up to date with code
✓ Use clear, simple language
✓ Include code examples
✓ Add diagrams for complex concepts
✓ Link related documentation
✓ Write for your audience (devs, users, etc.)
✓ Test code examples (must work)
```

---

## 8. Production Readiness

### Universal Pre-Production Checklist

```markdown
PRODUCTION READINESS CHECKLIST

═══════════════════════════════════════════════════
CODE QUALITY
═══════════════════════════════════════════════════
☐ All linting errors resolved
☐ All type errors fixed
☐ No commented-out code
☐ No debug/console logs in production
☐ No hardcoded values (use config)
☐ Error handling comprehensive
☐ Code reviewed and approved

═══════════════════════════════════════════════════
TESTING
═══════════════════════════════════════════════════
☐ Unit tests written and passing
☐ Integration tests passing
☐ E2E tests for critical paths passing
☐ Code coverage meets threshold (>80%)
☐ Performance testing completed
☐ Load testing completed (if applicable)
☐ Security testing completed
☐ Cross-browser/platform tested

═══════════════════════════════════════════════════
SECURITY
═══════════════════════════════════════════════════
☐ No secrets in code
☐ Environment variables for all sensitive data
☐ Dependencies scanned for vulnerabilities
☐ Input validation on all user inputs
☐ Output encoding/escaping
☐ Authentication implemented correctly
☐ Authorization checks in place
☐ HTTPS/TLS enforced (if web)
☐ CORS configured properly (if applicable)
☐ Rate limiting implemented (if applicable)
☐ SQL injection prevention
☐ XSS prevention
☐ CSRF protection (if applicable)

═══════════════════════════════════════════════════
PERFORMANCE
═══════════════════════════════════════════════════
☐ Load times acceptable (< 3s initial load)
☐ Bundle size optimized (if applicable)
☐ Images/assets optimized
☐ Code splitting implemented (if applicable)
☐ Lazy loading non-critical resources
☐ Caching strategies implemented
☐ Database queries optimized
☐ No N+1 query problems
☐ CDN configured (if applicable)

═══════════════════════════════════════════════════
ACCESSIBILITY (if UI)
═══════════════════════════════════════════════════
☐ WCAG level [A/AA/AAA] compliance verified
☐ Keyboard navigation works
☐ Screen reader tested
☐ Color contrast meets requirements
☐ Forms properly labeled
☐ ARIA attributes where needed
☐ Focus indicators visible

═══════════════════════════════════════════════════
USER EXPERIENCE (if UI)
═══════════════════════════════════════════════════
☐ Loading states for async operations
☐ Error messages clear and helpful
☐ Success feedback provided
☐ Empty states designed
☐ Responsive design (if web)
☐ Touch targets adequate (if mobile)
☐ Offline support (if PWA/mobile)

═══════════════════════════════════════════════════
DOCUMENTATION
═══════════════════════════════════════════════════
☐ README.md complete and accurate
☐ API documentation complete (if applicable)
☐ Architecture documented
☐ Deployment guide created
☐ Environment variables documented
☐ Inline code documentation
☐ CHANGELOG.md updated
☐ Contributing guide (if open source)

═══════════════════════════════════════════════════
INFRASTRUCTURE
═══════════════════════════════════════════════════
☐ Environment configuration correct
☐ Database migrations ready
☐ Backups configured
☐ Monitoring setup (logs, errors, metrics)
☐ Error tracking configured (Sentry, etc.)
☐ Analytics configured (if applicable)
☐ Health check endpoint (if backend)
☐ Graceful shutdown handling
☐ Zero-downtime deployment strategy

═══════════════════════════════════════════════════
DEPLOYMENT
═══════════════════════════════════════════════════
☐ Build process successful
☐ Environment-specific configs
☐ SSL/TLS certificates valid
☐ Domain/DNS configured
☐ CDN configured (if applicable)
☐ CI/CD pipeline working
☐ Rollback procedure documented
☐ Smoke tests after deployment

═══════════════════════════════════════════════════
COMPLIANCE & LEGAL
═══════════════════════════════════════════════════
☐ License file present
☐ Privacy policy (if collecting data)
☐ Terms of service (if applicable)
☐ GDPR compliance (if applicable)
☐ Cookie consent (if applicable)
☐ Accessibility statement (if required)
☐ Third-party licenses checked

═══════════════════════════════════════════════════
POST-DEPLOYMENT
═══════════════════════════════════════════════════
☐ Monitor error rates
☐ Monitor performance metrics
☐ Check logs for issues
☐ Verify all features work in production
☐ Test critical user paths
☐ Verify integrations working
☐ Check analytics/monitoring dashboards
```

---

## 9. Universal Patterns Library

### Authentication Pattern (Any Platform)

```markdown
Implement authentication for this application:

REQUIREMENTS:
═══════════════════════════════════════════════════
☐ User registration
☐ Login with credentials
☐ Logout
☐ Password reset flow
☐ Email/phone verification (optional)
☐ Session management
☐ Remember me functionality (optional)
☐ Multi-factor authentication (optional)

CHOOSE APPROPRIATE PATTERN FOR TECH STACK:
═══════════════════════════════════════════════════

Backend Options:
- JWT (stateless)
- Session-based (stateful)
- OAuth 2.0 / OpenID Connect
- Passport.js, Spring Security, Django Auth, etc.

Frontend/Mobile Options:
- Token storage (secure storage)
- Auth state management
- Protected routes/screens
- Auto-refresh tokens

SECURITY REQUIREMENTS:
═══════════════════════════════════════════════════
☐ Password hashing (bcrypt, argon2, scrypt)
☐ Salt passwords (automatically with modern libs)
☐ HTTPS only
☐ Secure token storage (httpOnly cookies, secure storage)
☐ Token expiration
☐ Refresh token rotation
☐ Rate limiting on auth endpoints
☐ Account lockout after failed attempts
☐ Password strength requirements
☐ No password in logs

IMPLEMENTATION:
═══════════════════════════════════════════════════

Backend:
1. Registration endpoint
2. Login endpoint
3. Logout endpoint
4. Password reset endpoints
5. Token verification middleware
6. User model with hashed passwords

Frontend/Mobile:
1. Auth state management
2. Login form
3. Registration form
4. Password reset form
5. Protected route/screen wrapper
6. Token refresh logic
7. Logout functionality

DELIVER:
1. Complete auth implementation
2. Security best practices applied
3. Error handling
4. Testing examples
5. Documentation
```

### CRUD Pattern (Universal)

```markdown
Implement CRUD operations for [Entity]:

REQUIREMENTS:
═══════════════════════════════════════════════════

Entity: [Name of resource/entity]
Fields: [List all fields with types]

OPERATIONS:
═══════════════════════════════════════════════════

CREATE:
- Input: [Entity data]
- Validation: [Rules]
- Response: Created entity

READ (List):
- Input: Optional filters, pagination, sorting
- Response: Array of entities + metadata

READ (Single):
- Input: Entity ID
- Response: Single entity or 404

UPDATE:
- Input: Entity ID + updated fields
- Validation: [Rules]
- Response: Updated entity

DELETE:
- Input: Entity ID
- Confirmation: [Soft/Hard delete?]
- Response: Success confirmation

BACKEND IMPLEMENTATION:
═══════════════════════════════════════════════════
1. Routes/endpoints for each operation
2. Controllers handling requests
3. Services with business logic
4. Data access layer (repository pattern)
5. Validation middleware
6. Error handling
7. Authorization checks

FRONTEND/CLIENT IMPLEMENTATION:
═══════════════════════════════════════════════════
1. API client functions
2. State management
3. List view with filters/search
4. Detail view
5. Create form
6. Edit form
7. Delete confirmation
8. Loading states
9. Error handling
10. Optimistic updates (optional)

DELIVER:
1. Complete implementation (backend + frontend if applicable)
2. Validation logic
3. Tests for each operation
4. Documentation
```

### Form Handling Pattern (Universal)

```markdown
Create a form for [Purpose]:

FORM SPECIFICATION:
═══════════════════════════════════════════════════

Fields:
1. [Field Name]: [Type] - [Validation Rules]
2. [Field Name]: [Type] - [Validation Rules]
3. [Field Name]: [Type] - [Validation Rules]

REQUIREMENTS:
═══════════════════════════════════════════════════

☐ Client-side validation
☐ Server-side validation
☐ Inline error messages
☐ Field-level error display
☐ Disabled submit until valid
☐ Loading state during submission
☐ Success feedback
☐ Error feedback
☐ Prevent duplicate submissions
☐ Accessible (labels, ARIA)
☐ Responsive design
☐ Auto-save (optional)
☐ Multi-step form (if complex)

VALIDATION RULES:
═══════════════════════════════════════════════════
- Required fields
- Format validation (email, phone, URL, etc.)
- Length constraints (min/max)
- Pattern matching (regex)
- Custom business rules
- Async validation (username availability, etc.)
- Cross-field validation

ERROR HANDLING:
═══════════════════════════════════════════════════
- Display errors next to fields
- Summary of errors at top
- Clear what needs to be fixed
- Preserve entered data on error

CHOOSE FORM LIBRARY (if applicable):
═══════════════════════════════════════════════════
- React Hook Form, Formik (React)
- VeeValidate (Vue)
- Angular Forms (Angular)
- Form validation library for your platform

DELIVER:
═══════════════════════════════════════════════════
1. Form component/screen
2. Validation logic (client + server)
3. Submit handler
4. Error display
5. Success handling
6. Accessibility features
7. Tests
```

---

## 10. AI Communication Best Practices

### Effective Prompting

```markdown
✅ GOOD PROMPTS - Specific, Contextual, Clear

Example 1: Component Creation
───────────────────────────────────────────────────
❌ BAD: "Make a login form"

✅ GOOD:
"Create a login form component with:
- Email and password fields
- Client-side validation (email format, required fields)
- Submit button disabled until valid
- Loading state during authentication
- Error display for failed login
- Link to forgot password
- Accessibility: proper labels, ARIA attributes
- Responsive design
Use [framework/library] and follow [style guide]"

Example 2: Bug Fix
───────────────────────────────────────────────────
❌ BAD: "Fix the user service"

✅ GOOD:
"The UserService.updateProfile() method is not properly handling validation errors from the API. It should:
1. Catch validation errors (400 status)
2. Display field-specific error messages
3. Not show generic error for validation issues
4. Preserve form data when validation fails

Current behavior: Shows generic error toast
Expected behavior: Highlight invalid fields with specific messages

Technology: [Framework/Language]
File location: src/services/UserService.[ext]"

Example 3: Feature Implementation
───────────────────────────────────────────────────
❌ BAD: "Add search"

✅ GOOD:
"Implement search functionality with these requirements:

SCOPE: Search across [entities: users, posts, comments]

FEATURES:
- Real-time search as user types
- Debounce input (300ms)
- Minimum 3 characters to trigger
- Display results grouped by entity type
- Highlight matching text
- Keyboard navigation (arrow keys, enter to select)
- Loading indicator
- Empty state for no results
- Clear search button

TECHNICAL:
- Backend: Create search API endpoint
- Frontend: Search component with autocomplete
- Use [specific library if preferred]
- Follow existing code patterns

PERFORMANCE:
- Limit results to 10 per entity type
- Cancel previous requests on new input"
```

### Context Provision

```markdown
ALWAYS PROVIDE:
═══════════════════════════════════════════════════
1. Project type (web, mobile, backend, etc.)
2. Tech stack (languages, frameworks)
3. What you've already built
4. What you're trying to achieve
5. Constraints or preferences
6. Any relevant code/patterns already in use

TEMPLATE:
───────────────────────────────────────────────────
CONTEXT:
- Project: [type and purpose]
- Stack: [technologies]
- Progress: [what's done]
- Need: [specific feature/fix]
- Constraints: [any limitations]
- Patterns: [existing patterns to follow]

REQUEST:
[Specific what you want]

ACCEPTANCE CRITERIA:
[How you'll know it's done right]
```

### Iterative Development

```markdown
WORKFLOW:
═══════════════════════════════════════════════════

1. PLAN FIRST
   Ask AI to create TODO list with phases

2. BUILD INCREMENTALLY
   Complete one feature at a time
   Mark TODOs complete as you go

3. VERIFY AND ITERATE
   Test each feature
   Request improvements
   Refactor as patterns emerge

4. QUALITY GATES
   Don't move forward until current phase is solid
   Address issues immediately

5. DOCUMENT AS YOU GO
   Keep docs updated
   Document decisions
   Record learnings
```

---

## Summary: The Universal Development Process

```
┌──────────────────────────────────────────────────────────┐
│                   1. REQUIREMENTS                         │
│  Define: Type, Features, Stack, Constraints              │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│                   2. ARCHITECTURE                         │
│  Design: Structure, Data Models, Patterns                │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│                   3. FOUNDATION (20%)                     │
│  Setup: Project, Tools, Core Utils, State                │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│                   4. FEATURES (50%)                       │
│  Build: One feature at a time, Test, Refactor            │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│                   5. POLISH (15%)                         │
│  Enhance: UX, Performance, Accessibility                 │
└────────────────────┬─────────────────────────────────────┘
                     │
                     ▼
┌──────────────────────────────────────────────────────────┐
│                   6. PRODUCTION (5%)                      │
│  Prepare: Docs, Tests, Security, Deploy                  │
└──────────────────────────────────────────────────────────┘
```

## Key Principles (Technology Agnostic)

### ✅ DO:
- Plan before coding
- Build incrementally
- Test as you go
- Handle errors gracefully
- Document everything
- Make it accessible (if UI)
- Optimize performance
- Follow security best practices
- Use type safety (when available)
- Track progress with TODOs

### ❌ DON'T:
- Skip planning
- Build everything at once
- Hardcode values
- Ignore errors
- Skip documentation
- Forget accessibility
- Premature optimization
- Ignore security
- Use weak typing (if types available)
- Rush to deployment

---

**This master prompt works for:**
- 🌐 Web (Frontend): React, Vue, Angular, Svelte, vanilla JS
- ⚙️ Backend: Node.js, Python, Go, Java, PHP, Ruby, .NET
- 📱 Mobile: React Native, Flutter, Swift, Kotlin, Xamarin
- 🖥️ Desktop: Electron, Tauri, Qt, WPF, SwiftUI
- 🛠️ CLI Tools: Any language
- 📦 Libraries: Any language

**Based on**: Real-world development of Next168 (Vue 3 + TypeScript weekly planner)

**Version**: 2.0 - Technology Agnostic
**Last Updated**: 2025-10-19
**License**: MIT - Free to use and adapt
