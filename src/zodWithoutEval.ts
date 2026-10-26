import { config } from 'zod'

// Zod's JIT builds parsers with `new Function`, which the page's Content Security Policy (index.html, no
// 'unsafe-eval') blocks and reports. This module must be imported before any schema is created.
config({ jitless: true })
