<script setup lang="ts">
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { usePlannerStore } from '@/stores/plannerStore'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import Sheet from '@/ui/Sheet.vue'
import { addLocalDays } from '@/core/time'
import { joinInline } from '@/ui/inlineText'
import { displayLocale, formatClock, formatDate } from '@/ui/format'
import GoogleConnectSheet from './GoogleConnectSheet.vue'
import { PERMISSIONS_URL, useGoogleConnection } from './useGoogleConnection'

// Settings › Calendars › Google Calendar: connect, update, disconnect, and a collapsed "Details" for the owner's
// spikes. Everything shown comes from this tab's memory; no address, id, title, token or Google text is displayed.
const { t } = useI18n()
const planner = usePlannerStore()
const google = useGoogleConnection()
const sheetOpen = ref(false)
const confirmOpen = ref(false)
const k = (key: string) => `calendars.googleConnection.${key}`

const zone = computed(() => planner.document?.settings.timeZone ?? 'UTC')
const connected = computed(() => google.session === 'connected')
const status = computed(() => {
  if (google.phase === 'authorizing') return t(k('authorizing'))
  if (google.phase === 'fetching') return t(k('fetching'))
  const coverage = google.coverage
  if (!coverage) return t(k('summary'))
  const count = google.occurrences.length
  return joinInline([t(k('updated'), { time: formatClock(coverage.fetchedAt, displayLocale.value, zone.value) }), t(k('eventCount'), { count }, count)])
})
const messageText = computed(() => google.message ? t(k(`messages.${google.message.key}`), google.message.params ?? {}) : '')
const primaryLabel = computed(() => (google.expired || !google.hasLiveToken() ? t(k('reconnect')) : t(k('update'))))

function connect(): void {
  sheetOpen.value = true
}

// Update asks Google for a token inside this tap when none is live; before Google's script is here, the sheet loads it.
function update(): void {
  if (!google.update()) sheetOpen.value = true
}

function disconnect(): void {
  confirmOpen.value = false
  void google.disconnect()
}

const yesNo = (value: boolean | undefined) => t(k(value === undefined ? 'details.none' : value ? 'details.yes' : 'details.no'))
const shortDate = (date: string) => formatDate(date, displayLocale.value, { day: 'numeric', month: 'short' })
const details = computed(() => {
  const none = t(k('details.none'))
  const last = (kind: 'token' | 'events' | 'revoke') => {
    const entry = google.diagnostics.last[kind]
    return entry ? t(k('details.result'), { result: entry.result, time: entry.at.slice(11, 16) }) : none
  }
  const minutes = google.remainingMinutes()
  const coverage = google.coverage
  return [
    { label: t(k('details.scope')), value: yesNo(google.diagnostics.scopeGranted) },
    { label: t(k('details.remaining')), value: minutes === undefined ? none : t(k('details.minutes'), { count: minutes }) },
    { label: t(k('details.token')), value: last('token') },
    { label: t(k('details.events')), value: last('events') },
    { label: t(k('details.revoke')), value: last('revoke') },
    { label: t(k('details.count')), value: String(google.occurrences.length) },
    { label: t(k('details.coverage')), value: coverage ? t(k('details.range'), { start: shortDate(coverage.start), end: shortDate(addLocalDays(coverage.end, -1)) }) : none },
  ]
})
</script>

<template>
  <section class="google" data-testid="google-calendar" :aria-labelledby="'google-calendar-title'">
    <div class="head">
      <span class="mark" aria-hidden="true"><Icon name="calendar-days" :size="20" /></span>
      <div class="head-text">
        <h3 id="google-calendar-title" class="t-headline">{{ t(k('title')) }}</h3>
        <p class="t-subhead t-secondary" data-testid="google-status" role="status">{{ status }}</p>
      </div>
    </div>
    <p v-if="google.message" class="t-subhead message" :class="`is-${google.message.tone}`" :role="google.message.tone === 'error' ? 'alert' : 'status'" data-testid="google-message">
      {{ messageText }}
      <a v-if="google.message.permissionsLink" :href="PERMISSIONS_URL" target="_blank" rel="noopener noreferrer" data-testid="google-permissions">{{ t(k('permissions')) }}</a>
    </p>
    <div class="actions">
      <Button v-if="!connected" variant="tinted" :disabled="google.busy" data-testid="google-connect" @click="connect">{{ t(k('connect')) }}</Button>
      <template v-else>
        <Button variant="tinted" :disabled="google.busy" data-testid="google-update" @click="update"><Icon name="refresh-cw" :size="18" />{{ primaryLabel }}</Button>
        <Button variant="plain" destructive :disabled="google.phase === 'revoking'" data-testid="google-disconnect" @click="confirmOpen = true">{{ t(k('disconnect')) }}</Button>
      </template>
    </div>
    <details class="details" data-testid="google-details">
      <summary class="t-subhead">{{ t(k('details.title')) }}</summary>
      <dl class="t-footnote">
        <template v-for="row in details" :key="row.label">
          <dt class="t-secondary">{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </template>
      </dl>
    </details>

    <GoogleConnectSheet v-model:open="sheetOpen" />
    <Sheet :open="confirmOpen" :title="t(k('disconnectTitle'))" @update:open="(open) => (confirmOpen = open)">
      <p class="t-body confirm-body">{{ t(k('disconnectBody')) }}</p>
      <template #footer>
        <div class="sheet-actions">
          <Button variant="plain" @click="confirmOpen = false">{{ t(k('cancel')) }}</Button>
          <Button destructive data-testid="google-disconnect-confirm" @click="disconnect">{{ t(k('disconnect')) }}</Button>
        </div>
      </template>
    </Sheet>
  </section>
</template>

<style scoped>
.google { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--card-padding-block) var(--card-padding); border-radius: var(--radius-card); background: var(--surface); overflow-wrap: anywhere; }
.google p, .google h3 { margin: 0; }
.head { display: flex; align-items: flex-start; gap: var(--space-3); }
.mark { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; background: color-mix(in srgb, var(--cat-blue) 16%, var(--surface)); color: var(--cat-blue); }
.head-text { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.message { padding: var(--space-2) var(--space-3); border-radius: var(--radius-control); background: var(--surface-2); text-wrap: pretty; }
.message.is-error { color: var(--danger-label); }
.message a { display: inline-block; margin-top: var(--space-1); color: var(--tint-label); font-weight: 600; text-decoration: none; }
.actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2) var(--space-5); }
.actions > * { max-width: 100%; white-space: normal; }
.actions .is-plain { padding-inline: 0; }
.details summary { min-height: var(--tap-target); display: flex; align-items: center; color: var(--label-2); cursor: pointer; }
.details dl { display: grid; grid-template-columns: minmax(0, auto) minmax(0, 1fr); gap: var(--space-1) var(--space-3); margin: 0 0 var(--space-2); font-variant-numeric: tabular-nums; }
.details dd { margin: 0; }
.confirm-body { margin: 0; text-wrap: pretty; }
.sheet-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.sheet-actions > * { min-height: 48px; }
@media (max-width: 767px) {
  .sheet-actions { flex-direction: column-reverse; }
  .sheet-actions > * { width: 100%; }
}
</style>
