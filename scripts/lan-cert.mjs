import { spawnSync } from 'node:child_process'
import { randomBytes, X509Certificate, createPrivateKey } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const directory = fileURLToPath(new URL('../.lan-https/', import.meta.url))
const caCert = join(directory, 'ca.crt')
const caKey = join(directory, 'ca.key')
const caName = 'Next168 local development CA'
const leafDays = 365

function openssl(args) {
  const result = spawnSync('openssl', args, { encoding: 'utf8' })
  if (result.error?.code === 'ENOENT') {
    throw new Error('OpenSSL is required. Install the system openssl tool, make it available on PATH, then rerun npm run lan:cert.')
  }
  if (result.error || result.status !== 0) {
    throw new Error(`OpenSSL failed: ${result.error?.message || result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`}`)
  }
}

function generate() {
  openssl(['version'])
  process.umask(0o077)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (existsSync(caCert) !== existsSync(caKey)) {
    throw new Error('Incomplete local CA. Remove its trust from your phones, delete .lan-https/, then rerun npm run lan:cert.')
  }
  const reuseCa = existsSync(caCert)
  if (reuseCa) {
    const ca = new X509Certificate(readFileSync(caCert))
    if (!ca.ca || !ca.checkPrivateKey(createPrivateKey(readFileSync(caKey)))) {
      throw new Error('The local CA certificate and key do not match or are not a CA. Remove phone trust and delete .lan-https/ before retrying.')
    }
    openssl(['x509', '-in', caCert, '-checkend', String(leafDays * 86400), '-noout'])
  }

  const addresses = [...new Set([
    '127.0.0.1', '::1',
    ...Object.values(networkInterfaces()).flatMap((entries) => entries ?? [])
      .filter((entry) => !entry.internal && !entry.address.includes('%') && !/^fe80:/i.test(entry.address))
      .map((entry) => entry.address),
  ])]
  const staging = mkdtempSync(join(directory, 'generate-'))
  try {
    const config = join(staging, 'openssl.cnf')
    writeFileSync(config, `
[req]
distinguished_name = dn
[dn]
CN = localhost
[ca]
basicConstraints = critical, CA:TRUE, pathlen:0
keyUsage = critical, keyCertSign, cRLSign
subjectKeyIdentifier = hash
[server]
basicConstraints = critical, CA:FALSE
keyUsage = critical, digitalSignature, keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid, issuer
subjectAltName = @names
[names]
DNS.1 = localhost
${addresses.map((address, index) => `IP.${index + 1} = ${address}`).join('\n')}
`)
    const signingCert = reuseCa ? caCert : join(staging, 'ca.crt')
    const signingKey = reuseCa ? caKey : join(staging, 'ca.key')
    if (!reuseCa) {
      openssl(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256',
        '-days', '3650', '-subj', `/CN=${caName}`, '-config', config,
        '-extensions', 'ca', '-keyout', signingKey, '-out', signingCert])
    }
    openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
      '-subj', '/CN=localhost', '-config', config,
      '-keyout', join(staging, 'server.key'), '-out', join(staging, 'server.csr')])
    openssl(['x509', '-req', '-sha256', '-in', join(staging, 'server.csr'),
      '-CA', signingCert, '-CAkey', signingKey, '-set_serial', `0x${randomBytes(16).toString('hex')}`,
      '-days', String(leafDays), '-extfile', config, '-extensions', 'server',
      '-out', join(staging, 'server.crt')])
    for (const file of reuseCa ? ['server.key', 'server.crt'] : ['ca.key', 'ca.crt', 'server.key', 'server.crt']) {
      renameSync(join(staging, file), join(directory, file))
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
  console.log(`${reuseCa ? 'Reused' : 'Created'} ${caName} (CA: 3650 days; server: ${leafDays} days).`)
  console.log('Transfer only .lan-https/ca.crt to your phone. Never share either .key file.')
  console.log('Run npm run build, then npm run preview:lan. Open one of:')
  for (const address of addresses.filter((address) => !address.includes(':') && address !== '127.0.0.1')) {
    console.log(`  https://${address}:4443/`)
  }
  console.log('  https://localhost:4443/ (this computer only)')
  console.log('Trust is temporary: remove the CA from your phone and delete .lan-https/ after use.')
}

try {
  generate()
} catch (error) {
  console.error(`LAN certificate generation failed: ${error.message}`)
  process.exitCode = 1
}
