// The device's light/dark choice, before the first paint (src/ui/appearance.ts owns this key and these colours).
try {
  var appearance = localStorage.getItem('next168-appearance')
  if (appearance === 'light' || appearance === 'dark') {
    document.documentElement.dataset.theme = appearance
    document.querySelectorAll('meta[name="theme-color"]').forEach(function (meta) { meta.content = appearance === 'dark' ? '#000000' : '#F2F2F7' })
  }
} catch { /* storage blocked */ }

// The page's language before the first paint (src/i18n/index.ts owns this key and the same detection), so the
// browser never offers to translate a page that is already in the person's language.
(function () {
  var supported = ['en', 'es', 'fr', 'pt', 'de']
  var saved = null
  try { saved = localStorage.getItem('next168-language') } catch { /* storage blocked */ }
  var browser = (navigator.language || '').split('-')[0]
  document.documentElement.lang = supported.indexOf(saved) >= 0 ? saved : supported.indexOf(browser) >= 0 ? browser : 'en'
})()
