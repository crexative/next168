import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const result = spawnSync(process.execPath, [
  fileURLToPath(new URL('node_modules/vite/bin/vite.js', root)),
  'preview', '--host', '0.0.0.0', '--port', '4443', '--strictPort',
], {
  cwd: fileURLToPath(root),
  stdio: 'inherit',
  env: {
    ...process.env,
    NEXT168_HTTPS_CERT: process.env.NEXT168_HTTPS_CERT || '.lan-https/server.crt',
    NEXT168_HTTPS_KEY: process.env.NEXT168_HTTPS_KEY || '.lan-https/server.key',
  },
})
if (result.error) console.error(`Cannot start LAN preview: ${result.error.message}`)
process.exitCode = result.status ?? 1
