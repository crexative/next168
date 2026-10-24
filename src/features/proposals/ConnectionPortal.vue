<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, nextTick } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import { companionMode, companionRequest, pairCompanion, pairingRequired } from '@/repositories/CompanionRepository'
import { pendingCount, refreshPending } from './pending'

const { t } = useI18n()
const code = ref('')
const busy = ref(false)
const error = ref(false)
const pairingForm = ref<HTMLFormElement | null>(null)
watch(pairingRequired, async required => {
  document.getElementById('app')?.toggleAttribute('inert', required)
  if (required) { await nextTick(); pairingForm.value?.querySelector('input')?.focus() }
}, { immediate: true })
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return
  const items = pairingForm.value?.querySelectorAll<HTMLElement>('input:not(:disabled), button:not(:disabled)')
  if (!items?.length) { event.preventDefault(); return }
  if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items[items.length - 1]?.focus() }
  else if (!event.shiftKey && document.activeElement === items[items.length - 1]) { event.preventDefault(); items[0]?.focus() }
}
let timer: ReturnType<typeof setInterval> | undefined
const pairingFragment = location.hash.startsWith('#pair=') ? location.hash.slice(6) : ''
if (pairingFragment) {
  code.value = pairingFragment
  history.replaceState(null, '', `${location.pathname}${location.search}#/settings`)
}
async function pair() {
  if (busy.value) return
  busy.value = true; error.value = false
  try { await pairCompanion(code.value.trim()); code.value = ''; await poll() }
  catch { error.value = true }
  finally { busy.value = false }
}
async function poll() {
  if (document.visibilityState === 'hidden' || (companionMode && pairingRequired.value)) return
  try { await refreshPending() } catch { /* Keep the last observed count during a transient connection error. */ }
}
onMounted(async () => {
  if (pairingFragment) await pair()
  else if (companionMode) { try { await companionRequest('/document') } catch { /* Pairing panel remains open. */ } }
  await poll()
  timer = setInterval(() => { void poll() }, 5000)
  document.addEventListener('visibilitychange', poll)
})
onBeforeUnmount(() => { clearInterval(timer); document.removeEventListener('visibilitychange', poll) })
</script>

<template>
  <div v-if="companionMode && pairingRequired" class="pairing-overlay" role="dialog" aria-modal="true" aria-labelledby="pair-title">
    <form ref="pairingForm" class="pairing-card" @submit.prevent="pair" @keydown="trapFocus">
      <h1 id="pair-title" class="t-title-2">{{ t('connect.pairTitle') }}</h1>
      <p>{{ t('connect.pairDescription') }}</p>
      <label for="pair-code">{{ t('connect.pairCode') }}</label>
      <input id="pair-code" v-model="code" type="password" autocomplete="off" required :disabled="busy" />
      <p v-if="error" role="alert">{{ t('connect.pairError') }}</p>
      <Button type="submit" :disabled="busy || !code.trim()">{{ t('connect.pair') }}</Button>
    </form>
  </div>
  <a v-else-if="pendingCount > 0" class="proposal-badge" href="#/proposals" data-testid="proposal-badge" :aria-label="t('proposals.pending', { count: pendingCount })">
    {{ t('proposals.pending', { count: pendingCount }) }}
  </a>
</template>

<style scoped>
.pairing-overlay { position: fixed; inset: 0; z-index: 200; background: var(--bg); display: grid; place-items: center; padding: var(--space-4); }
.pairing-card { width: min(100%, 28rem); display: grid; gap: var(--space-4); border-radius: var(--radius-card); background: var(--surface); padding: var(--space-6); }
input { width: 100%; min-height: var(--tap-target); padding: var(--space-2); border: 1px solid var(--separator); border-radius: var(--radius-control); background: var(--surface-2); color: var(--label); }
.proposal-badge { position: fixed; z-index: 40; inset-inline-end: var(--space-4); bottom: calc(var(--tabbar-height) + var(--safe-bottom) + var(--space-3)); min-height: var(--tap-target); display: flex; align-items: center; padding: var(--space-2) var(--space-4); border-radius: var(--radius-control); background: var(--tint); color: var(--tint-text); text-decoration: none; box-shadow: var(--shadow-floating); }
@media (min-width: 1024px) { .proposal-badge { bottom: var(--space-4); } }
</style>
