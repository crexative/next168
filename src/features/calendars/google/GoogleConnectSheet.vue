<script setup lang="ts">
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import Button from '@/ui/Button.vue'
import Icon from '@/ui/Icon.vue'
import Sheet from '@/ui/Sheet.vue'
import { useGoogleConnection } from './useGoogleConnection'

// What connecting means, said before Google's window opens. Opening the sheet loads Google's script; the button waits
// for it, so the tap that follows asks Google directly (a popup must come from the tap itself).
const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ 'update:open': [open: boolean] }>()
const { t } = useI18n()
const google = useGoogleConnection()

watch(() => props.open, (open) => { if (open) google.prepare() }, { immediate: true })

const points = computed(() => ['memoryOnly', 'refreshHint', 'aiBusy', 'testing'].map((key) => t(`calendars.googleConnection.${key}`)))
const loadFailed = computed(() => google.gis === 'failed')

function onContinue(): void {
  if (loadFailed.value) { google.prepare(); return }
  if (google.update()) emit('update:open', false)
}
</script>

<template>
  <Sheet :open="open" :title="t('calendars.googleConnection.sheetTitle')" @update:open="(next) => emit('update:open', next)">
    <div class="connect" data-testid="google-connect-sheet">
      <p class="t-body lead">{{ t('calendars.googleConnection.readOnly') }}</p>
      <ul class="points t-subhead">
        <li v-for="point in points" :key="point"><Icon name="check" :size="16" class="point-mark" />{{ point }}</li>
      </ul>
      <p v-if="loadFailed" class="t-subhead failure" role="alert">{{ t('calendars.googleConnection.messages.gisLoad') }}</p>
    </div>
    <template #footer>
      <div class="actions">
        <Button variant="plain" @click="emit('update:open', false)">{{ t('calendars.googleConnection.cancel') }}</Button>
        <Button :disabled="google.gis === 'loading' || google.busy" data-testid="google-continue" @click="onContinue">
          {{ google.gis === 'loading' ? t('calendars.googleConnection.loading') : loadFailed ? t('calendars.googleConnection.retryLoad') : t('calendars.googleConnection.continue') }}
        </Button>
      </div>
    </template>
  </Sheet>
</template>

<style scoped>
.connect { display: flex; flex-direction: column; gap: var(--space-4); }
.connect p { margin: 0; }
.lead { text-wrap: pretty; }
.points { display: flex; flex-direction: column; gap: var(--space-3); margin: 0; padding: 0; list-style: none; color: var(--label-2); }
.points li { display: grid; grid-template-columns: 16px minmax(0, 1fr); gap: var(--space-3); align-items: start; overflow-wrap: anywhere; text-wrap: pretty; }
.point-mark { margin-top: 3px; color: var(--tint); }
.failure { color: var(--danger-label); }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: var(--space-2); }
.actions > * { min-height: 48px; }
@media (max-width: 767px) {
  .actions { flex-direction: column-reverse; }
  .actions > * { width: 100%; }
}
</style>
