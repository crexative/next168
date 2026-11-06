// Temporary owner canary (§8.2), deleted by S1c. It shows result codes only and never a token.
import { deps, type PagesContext } from '../../../../server/google/deps'
import { servePage } from '../../../../server/google/http'

const CSP = "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'unsafe-inline'"

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Weeklid canary">
<title>Weeklid Google canary</title>
<style>
body { font: 16px/1.4 system-ui, sans-serif; margin: 16px; max-width: 32rem; }
button { font: inherit; padding: 0.6em 1em; margin: 0.25em 0.25em 0.25em 0; }
output { display: block; margin-top: 1em; font-family: ui-monospace, monospace; white-space: pre-wrap; }
</style>
</head>
<body>
<h1>Google connection canary</h1>
<p>A temporary test page for the owner. It shows result codes only.</p>
<button id="start" type="button">Start</button>
<button id="mint" type="button">Mint ×3</button>
<button id="disconnect" type="button">Disconnect</button>
<output id="result" aria-live="polite">ready</output>
<script src="/api/google/canary/script"></script>
</body>
</html>
`

export const onRequestGet = (ctx: PagesContext): Promise<Response> =>
  servePage(deps(ctx.env), 'canary', ctx.request, 'text/html; charset=utf-8', PAGE, CSP)
