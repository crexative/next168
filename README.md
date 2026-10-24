# Next168 - Master Your Next 168 Hours

> **A smart weekly planner that helps you visualize, structure, and balance your time with clarity and purpose.**

Next168 is a powerful weekly time management application built with Vue 3, TypeScript, and modern web technologies. The app helps you plan and optimize your 168-hour week through intelligent categorization, visual scheduling, and comprehensive analytics.

🌐 **Official Website**: [next168.app](https://next168.app)

## ✨ What is Next168?

Next168 transforms how you approach your week by providing a complete system for planning and tracking your 168 hours. Every week has exactly 168 hours - the difference is in how you live them.

### Core Features

- **📅 Visual Weekly Calendar**: Plan your time blocks across a complete 7-day view with smart scheduling
- **🏷️ Category Management**: Create custom categories with icons, colors, and weekly hour limits
- **📊 Real-time Analytics**: Track your weekly usage with interactive charts and progress visualization
- **✅ Smart Validation**: Prevents time overlaps, enforces category limits, and ensures data integrity
- **🌍 Multilingual**: Full support for English, Spanish, French, Portuguese, and German
- **📱 Responsive Design**: Optimized experience across desktop, tablet, and mobile devices
- **🎯 Accessibility**: WCAG 2.1 Level AA compliant with proper contrast ratios and ARIA labels

## 🎨 The Next168 Philosophy

Next168 doesn't just help you organize your days - it helps you **anticipate your week** with balance and clarity. The platform combines:

- **Visual time management** with color-coded categories and blocks
- **Intelligent analytics** showing weekly utilization and category breakdown
- **Mobile-first design** with native app patterns and touch interactions
- **Effortless planning** through intuitive interfaces and smart defaults

> "Every week has 168 hours. The difference is in how you live them."

## 🚀 Features

### 📅 Weekly Calendar

**Desktop View** (1024px+)
- Full 7-day grid layout for comprehensive overview
- Quick-add buttons on each day column
- Click any time block to edit details
- Visual "today" highlighting

**Tablet View** (769-1024px)
- 3-column sliding view with center day focus
- Navigation arrows to move through the week
- "Today" quick-jump button

**Mobile View** (≤768px)
- Single-day view with swipe gestures
- Bottom tab navigation
- Floating Action Button (FAB) for quick adds
- Native app-like experience

### 🏷️ Category System

- Create unlimited custom categories
- 24 emoji icon options with smart suggestions
- Color picker with random color generator
- Weekly hour limits (0.5 - 168 hours)
- Real-time usage tracking and progress bars
- Validation prevents deleting categories with active blocks

### 📊 Statistics Dashboard

**Summary Cards**
- Scheduled Hours
- Available Hours
- Total Blocks
- Categories Count

**Visualizations**
- Category breakdown with progress indicators
- Daily distribution chart (Chart.js)
- Week utilization overview
- Real-time percentage calculations

### ✅ Smart Validation

- Prevents time block overlaps
- Enforces category hour limits
- Validates time formats (24-hour)
- Handles cross-midnight time blocks
- Clear, translated error messages
- Category deletion protection

### 🌍 Internationalization (i18n)

Complete translations for:
- 🇺🇸 English: "Master your next 168 hours."
- 🇪🇸 Español: "Domina tus próximas 168 horas."
- 🇫🇷 Français: "Maîtrisez vos prochaines 168 heures."
- 🇧🇷 Português: "Domine suas próximas 168 horas."
- 🇩🇪 Deutsch: "Meistern Sie Ihre nächsten 168 Stunden."

Auto-detects browser language with localStorage persistence.

### 💾 Data Persistence

- Every change is saved to the browser's IndexedDB in one durable transaction (older localStorage data is imported once)
- Data persists across sessions
- Sample data for new users
- No backend required
- Export/import ready architecture

## 🛠️ Technology Stack

- **Vue 3** - Composition API with TypeScript
- **Vite** - Fast build tool and dev server
- **Pinia** - State management
- **vue-i18n** - Internationalization
- **Chart.js** - Data visualizations
- **Day.js** - Date/time manipulation
- **TypeScript** - Type-safe development

## 📦 Installation

### Prerequisites

- Node.js 20.19.0+ or 22.12.0+ (see `package.json` engines)
- npm or yarn

### Quick Start

```bash
# Clone the repository
git clone <your-repo-url>
cd next168

# Install dependencies
npm install

# Start development server
npm run dev

# Open browser to http://localhost:5173
```

### Available Scripts

```bash
npm run dev          # Start Vite dev server
npm run build        # Type-check and build for production
npm run preview      # Preview production build
npm run lan:cert     # Create local certificates for phone installation
npm run preview:lan  # Preview production build over HTTPS on the LAN (port 4443)
npm run type-check   # Run TypeScript type checking
npm run lint         # Run ESLint with auto-fix
```

To install the PWA on a real Android phone or iPhone, follow
[Install Next168 on a phone](docs/install-on-a-phone.md) for local HTTPS, CA trust,
offline checks, and the Android USB alternative. No hosting account is needed.

### Testing

```bash
npx vitest run                      # unit tests
npx playwright test                 # end-to-end: desktop, tablet and phone (webkit-phone when WebKit is installed)
```

Playwright builds the app and serves it itself, on two preview ports (root and `/next168/` sub-path)
derived from a stable hash of the checkout's path, so runs in different worktrees at the same time
can never test each other's build. It never reuses a server that is already running. Set
`PW_PORT_BASE=<port>` to pick the root port yourself (the sub-path server uses the next one).

CI runs on Linux, whose fonts lay text out differently from macOS, so a green run on a Mac proves
little for layout. Before pushing, reproduce CI's rendering with `npm run test:e2e:linux` (any
`playwright test` arguments follow `--`, for example `npm run test:e2e:linux -- e2e/visual-integrity.spec.ts`).
It needs a running Docker engine (`colima start --cpu 4 --memory 6`), runs inside Playwright's official image for
the locked version plus DejaVu fonts as on GitHub's runners, keeps its own `node_modules` and build in Docker
volumes, and writes reports back to `e2e/.results` and `e2e/.report`. Set `NEXT168_E2E_LINUX_PLATFORM=linux/amd64`
to match CI's CPU architecture (slow under emulation).

## 🏗️ Architecture

### Project Structure

```
src/
├── components/
│   ├── CategoryManager.vue      # Category CRUD with emoji picker
│   ├── WeeklyCalendar.vue       # Responsive calendar views
│   ├── StatsDashboard.vue       # Analytics and charts
│   ├── LanguageSelector.vue     # i18n language switcher
│   ├── BaseBottomSheet.vue      # Mobile bottom sheet modal
│   └── ui/
│       ├── BaseModal.vue        # Desktop/tablet modal
│       └── TimePicker.vue       # Time input component
├── stores/
│   └── weekStore.ts             # Pinia state management
├── services/
│   ├── ValidationService.ts     # Business logic validation
│   └── StorageService.ts        # localStorage abstraction
├── i18n/
│   ├── index.ts                 # i18n configuration
│   └── locales/                 # Translation files (en/es/fr/pt/de)
├── utils/
│   └── timeCalculator.ts        # Time calculation utilities
├── types/
│   └── index.ts                 # TypeScript definitions
└── assets/
    ├── base.css                 # CSS variables and theme
    └── main.css                 # Global styles
```

### Design Principles

**Clean Architecture**
- Separation of concerns (UI, business logic, data)
- Service layer for reusable logic
- Type-safe interfaces throughout

**SOLID Principles**
- Single Responsibility: Each service has one purpose
- Open/Closed: Extensible through interfaces
- Dependency Inversion: Abstractions over implementations

**Responsive Design System**
- CSS variables for theming
- Mobile-first approach
- Three breakpoints: mobile (≤768px), tablet (769-1024px), desktop (>1024px)

## 🎨 Branding & Design

### Next168 Brand Colors

```css
--next168-blue-deep: #1C2E4A;    /* Trust and focus */
--next168-green-neon: #30E6A5;   /* Energy and progress */
--next168-green-dark: #0D9B6E;   /* Accessible contrast */
--next168-gray-light: #F4F5F7;   /* Clean balance */
--next168-black: #0D0D0D;        /* Visual strength */
```

### Accessibility

- WCAG 2.1 Level AA compliant
- Color contrast ratios >4.5:1
- Proper ARIA labels on interactive elements
- Keyboard navigation support
- Screen reader friendly

## 📱 Responsive Behavior

### Desktop (>1024px)
- 7-column calendar grid
- Modal dialogs for forms
- Hover states on interactive elements

### Tablet (769-1024px)
- 3-column sliding calendar
- Modal dialogs for forms
- Adaptive grid layouts

### Mobile (≤768px)
- Single-day calendar view
- Bottom sheets instead of modals
- Floating Action Buttons (FABs)
- Swipe gestures for tab navigation
- Touch feedback (scale on press)
- Safe area insets for notched devices

## 🚀 Deployment

### Build for Production

```bash
# Run type checking and build
npm run build

# Output will be in /dist directory
```

### Deployment Platforms

**Recommended:**
- **Vercel**: Zero-config deployment for Vite apps
- **Netlify**: Continuous deployment from Git
- **GitHub Pages**: Free static hosting
- **Cloudflare Pages**: Global CDN deployment

### Environment Setup

No environment variables required - the app is fully client-side.

For custom domain:
1. Update `base` in `vite.config.ts` if needed
2. Configure DNS settings with your provider
3. Deploy `/dist` folder

## 🌐 Browser Support

- Chrome/Edge (latest)
- Firefox (latest)
- Safari (latest)
- iOS Safari 12+
- Chrome Mobile

## 📖 Usage Guide

### Getting Started

1. **Create Your First Category**
   - Navigate to Categories tab
   - Click "Add Category"
   - Choose name, icon, color, and weekly limit

2. **Schedule Time Blocks**
   - Go to Calendar tab
   - Click "Add Time Block" or use FAB on mobile
   - Fill in details: title, category, day, times

3. **Track Your Progress**
   - View Statistics tab for analytics
   - Monitor category usage vs. limits
   - Review weekly utilization

### Best Practices

- Start with 4-6 core categories (Sleep, Work, Exercise, Learning, etc.)
- Set realistic weekly hour limits
- Use descriptive titles for time blocks
- Review statistics weekly to adjust planning

## 🤝 Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 📄 License

MIT License - Free to use for personal or commercial purposes.

## 🙏 Acknowledgments

- Vue.js team for the amazing framework
- Chart.js for beautiful visualizations
- Crexative ecosystem for design inspiration

---

**Next168** - Plan your next 168 hours, effortlessly.

Built with ❤️ using Vue 3, TypeScript, and modern web technologies.

🌐 [next168.app](https://next168.app)
