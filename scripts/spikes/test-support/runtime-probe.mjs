// Observe the child's actual argv/environment at the point it transmits a secret.
const originalFetch = globalThis.fetch
globalThis.fetch = (url, options) => {
  const secret = new URLSearchParams(options?.body).get('client_secret')
  if (secret) {
    process.send?.({ runtimeClean: !JSON.stringify([process.argv, process.env]).includes(secret) })
  }
  return originalFetch(url, options)
}

// Accelerate only the consent clock in this synthetic child; production has no timeout override.
if (process.env.WEEKLID_SPIKE_TEST_EXPIRE_CONSENT === '1') {
  const timeout = AbortSignal.timeout
  AbortSignal.timeout = milliseconds => timeout(milliseconds === 300000 ? 100 : milliseconds)
}
